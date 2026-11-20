//! The diff view: one file's changes (working tree, index, a commit) or many (a whole commit, a
//! stash, two refs compared), unified or side by side, with hunk actions on working and staged
//! diffs. After Athas's `git-diff-viewer`, `git-diff-header` and `git-diff-hunk-header`.

use std::{ops::Range, path::PathBuf, rc::Rc, sync::Arc};

use gpui::{
    Anchor, AnyElement, App, ClickEvent, Context, ElementId, Entity, EventEmitter, FocusHandle, Focusable, HighlightStyle,
    Hsla, KeyBinding, ListOffset, MouseButton, Pixels, Point, Render, SharedString, StyledText, Subscription, Window,
    actions, div, img, list, point, prelude::*, px, relative,
};
use multibuffer::{Entry, Header, Multibuffer, Section, Tone};
use regex::{Regex, RegexBuilder};
use theme::{ActiveTheme, ThemeColors};
use ui::{
    Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, InputAppearance, MenuEntry, MenuItem, OpenMenu, TextInput,
    TextInputEvent, typography,
};

use crate::{
    git::{self, HunkAction},
    model::{self, Cell, FileContent, FileDiff, FileStatus, Folds, ImageSide, Layout, LineKind, Notice, Row},
    selection::{TextPoint, TextSelection},
    target::DiffTarget,
    widgets::{diff_numbers, display_text, fill_message, status_badge, visible_whitespace},
};

actions!(git_diff, [NextHunk, PreviousHunk, ToggleLayout, Reload, Find, FindNext, FindPrevious, CopySelection, SelectAllLines]);

const KEY_CONTEXT: &str = "GitDiffView";
const LINE_HEIGHT: Pixels = px(20.);
const NUMBER_WIDTH: Pixels = px(44.);

pub(crate) fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "git_diff", bind_keys);
}

fn bind_keys(cx: &mut App) {
    let context = Some(KEY_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("alt-down", NextHunk, context),
        KeyBinding::new("alt-up", PreviousHunk, context),
    ]);
    let mac = cfg!(target_os = "macos") || (cfg!(target_family = "wasm") && cx.platform_info().os == gpui::OperatingSystem::Mac);
    let (find, next, previous) = if mac { ("cmd-f", "cmd-g", "cmd-shift-g") } else { ("ctrl-f", "ctrl-g", "ctrl-shift-g") };
    cx.bind_keys([KeyBinding::new(find, Find, context), KeyBinding::new(next, FindNext, context), KeyBinding::new(previous, FindPrevious, context)]);
    let (copy, all) = if mac { ("cmd-c", "cmd-a") } else { ("ctrl-c", "ctrl-a") };
    cx.bind_keys([KeyBinding::new(copy, CopySelection, context), KeyBinding::new(all, SelectAllLines, context)]);
}

#[derive(Clone, Copy)]
enum SelectPhase {
    Start { extend: bool },
    Drag,
}

enum State {
    Loading,
    Failed(SharedString),
    Ready,
}

/// A match of the diff search: a row, the side of a split row (0 for the left or only one) and
/// the byte range in that cell's text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FindMatch {
    pub row: usize,
    pub side: u8,
    pub range: Range<usize>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FindOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// The pattern a search runs; `None` for an empty query, `Some(Err)` for an invalid expression.
pub fn find_regex(query: &str, options: FindOptions) -> Option<Result<Regex, regex::Error>> {
    if query.is_empty() {
        return None;
    }
    let pattern = if options.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if options.whole_word { format!(r"\b(?:{pattern})\b") } else { pattern };
    Some(RegexBuilder::new(&pattern).case_insensitive(!options.case_sensitive).build())
}

/// Every match of `regex` among the rows' lines (`multi-diff-search`); a split row's unchanged
/// line counts once.
pub fn find_matches(rows: &[Row], regex: &Regex) -> Vec<FindMatch> {
    let mut out = Vec::new();
    let mut push = |row: usize, side: u8, cell: &Cell| {
        out.extend(regex.find_iter(&cell.text).filter(|found| !found.is_empty()).map(|found| FindMatch { row, side, range: found.range() }));
    };
    for (index, row) in rows.iter().enumerate() {
        match row {
            Row::Line { cell, .. } => push(index, 0, cell),
            Row::Split { left, right, .. } => {
                if let Some(left) = left {
                    push(index, 0, left);
                }
                if let Some(right) = right
                    && right.kind != LineKind::Context
                {
                    push(index, 1, right);
                }
            }
            _ => {}
        }
    }
    out
}

struct FindBar {
    input: Entity<TextInput>,
    query: String,
    options: FindOptions,
    matches: Vec<FindMatch>,
    current: Option<usize>,
    invalid: bool,
    _subscription: Subscription,
}

pub struct DiffView {
    root: PathBuf,
    target: DiffTarget,
    focus_handle: FocusHandle,
    state: State,
    files: Vec<FileDiff>,
    layout: Layout,
    folds: Folds,
    rows: Vec<Row>,
    hunk_rows: Vec<usize>,
    /// The hunk header row navigation last went to.
    current_hunk: Option<usize>,
    multibuffer: Multibuffer<Self>,
    /// Each file's rows among `rows`.
    file_ranges: Vec<Range<usize>>,
    /// For a whole working tree diff, whether each file is its staged side.
    sides: Vec<bool>,
    show_whitespace: bool,
    image_zoom: f32,
    /// Syntax colours per file, filled in the background after a load.
    syntax: Vec<crate::highlight::FileSyntax>,
    find: Option<FindBar>,
    github_url: Option<String>,
    /// The subject and author of a commit diff.
    commit: Option<(SharedString, SharedString, String)>,
    /// Bumped per load, so a late result of an older load is dropped.
    generation: usize,
    busy: bool,
    error: Option<SharedString>,
    open_menu: Option<OpenMenu>,
    /// Text selected in the lines with the mouse.
    text_selection: Option<TextSelection>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl EventEmitter<()> for DiffView {}

impl Focusable for DiffView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// The layout the `gitDefaultDiffView` setting asks for.
fn saved_layout(cx: &App) -> Layout {
    if cx.has_global::<settings::SettingsStore>() {
        Layout::from_setting(&settings::get(cx).git_default_diff_view)
    } else {
        Layout::Unified
    }
}

impl DiffView {
    pub fn new(root: PathBuf, target: DiffTarget, window: &mut Window, cx: &mut Context<Self>) -> Self {
        init(cx);
        let mut subscriptions = Vec::new();
        // The working tree and the index change behind the view's back: read them again whenever
        // the window comes back to the front.
        if target.is_editable() {
            subscriptions.push(cx.observe_window_activation(window, |this, window, cx| {
                if window.is_window_active() {
                    this.load(cx);
                }
            }));
        }
        let mut view = Self {
            root,
            target,
            focus_handle: cx.focus_handle(),
            state: State::Loading,
            files: Vec::new(),
            layout: saved_layout(cx),
            folds: Folds::default(),
            rows: Vec::new(),
            hunk_rows: Vec::new(),
            current_hunk: None,
            multibuffer: Multibuffer::new("git-diff", true, |this: &mut Self| &mut this.multibuffer, window, cx),
            file_ranges: Vec::new(),
            sides: Vec::new(),
            show_whitespace: false,
            image_zoom: 1.,
            syntax: Vec::new(),
            find: None,
            github_url: None,
            commit: None,
            generation: 0,
            busy: false,
            error: None,
            open_menu: None,
            text_selection: None,
            _subscriptions: subscriptions,
        };
        view.load(cx);
        view.load_details(cx);
        view
    }

    /// The commit subject and author, and the GitHub link, for the pane header.
    fn load_details(&mut self, cx: &mut Context<Self>) {
        let (root, target) = (self.root.clone(), self.target.clone());
        let task = cx.background_spawn(async move {
            let commit = match &target {
                DiffTarget::Commit { commit } => git::commit_details(&root, commit).ok().map(|details| (details.summary, details.author.name, details.author.email)),
                _ => None,
            };
            (commit, git::github_url(&root, &target))
        });
        cx.spawn(async move |this, cx| {
            let (commit, github_url) = task.await;
            this.update(cx, |this, cx| {
                this.commit = commit.map(|(summary, author, email)| (summary.into(), author.into(), email));
                this.github_url = github_url;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn target(&self) -> &DiffTarget {
        &self.target
    }

    pub fn files(&self) -> &[FileDiff] {
        &self.files
    }

    pub fn layout(&self) -> Layout {
        self.layout
    }

    fn multi_file(&self) -> bool {
        self.target.path().is_none()
    }

    /// The diff a file's hunks belong to: a whole working tree diff stages and unstages each file
    /// as its own working or staged diff would.
    fn file_target(&self, file: usize) -> DiffTarget {
        match (&self.target, self.files.get(file), self.sides.get(file)) {
            (DiffTarget::WorkingTree { .. }, Some(diff), Some(&staged)) => {
                if staged { DiffTarget::Staged { path: diff.path.clone() } } else { DiffTarget::Working { path: diff.path.clone() } }
            }
            _ => self.target.clone(),
        }
    }

    /// Reads the diff again, keeping folds and the scroll position.
    pub fn load(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        let (root, target) = (self.root.clone(), self.target.clone());
        let task = cx.background_spawn(async move {
            match target {
                DiffTarget::WorkingTree { scope } => git::load_working_tree(&root, scope).map(|files| files.into_iter().unzip()),
                target => git::load(&root, &target).map(|files| (Vec::new(), files)),
            }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                match result {
                    Ok((sides, files)) => {
                        if files != this.files || sides != this.sides || !matches!(this.state, State::Ready) {
                            this.files = files;
                            this.sides = sides;
                            this.state = State::Ready;
                            this.rebuild();
                            this.highlight(generation, cx);
                        }
                    }
                    Err(error) => this.state = State::Failed(format!("{error:#}").into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Colours the files' lines in the background.
    fn highlight(&mut self, generation: usize, cx: &mut Context<Self>) {
        let files = self.files.clone();
        let task = cx.background_spawn(async move { files.iter().map(crate::highlight::file_syntax).collect::<Vec<_>>() });
        cx.spawn(async move |this, cx| {
            let syntax = task.await;
            this.update(cx, |this, cx| {
                if this.generation == generation {
                    this.syntax = syntax;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    /// A line's syntax colours: removed lines from the old side, the rest from the new.
    fn syntax_colors(&self, file: usize, cell: &Cell, old_side: bool, cx: &App) -> Vec<(Range<usize>, Hsla)> {
        let old_side = old_side || cell.kind == LineKind::Removed;
        let Some(spans) = self.syntax.get(file).and_then(|syntax| syntax.line(old_side, if old_side { cell.old } else { cell.new })) else {
            return Vec::new();
        };
        let theme = cx.theme();
        spans.iter().map(|(range, kind)| (range.clone(), kind.color(theme))).collect()
    }

    fn rebuild(&mut self) {
        self.text_selection = None;
        self.rows = model::build_rows(&self.files, self.layout, &self.folds, false);
        self.hunk_rows = model::hunk_rows(&self.rows);
        self.file_ranges = (0..self.files.len()).map(|_| 0..0).collect();
        let mut start = 0;
        while start < self.rows.len() {
            let file = self.rows[start].file();
            let end = start + self.rows[start..].iter().take_while(|row| row.file() == file).count();
            if let Some(range) = self.file_ranges.get_mut(file) {
                *range = start..end;
            }
            start = end;
        }
        let sections = self.files.iter().enumerate().map(|(index, file)| self.section(index, file)).collect();
        self.multibuffer.set_sections(sections, false);
        if self.current_hunk.is_some_and(|row| !self.hunk_rows.contains(&row)) {
            self.current_hunk = None;
        }
        self.refresh_find();
    }

    fn section(&self, index: usize, file: &FileDiff) -> Section {
        let side = match (&self.target, self.sides.get(index)) {
            (DiffTarget::WorkingTree { .. }, Some(true)) => "staged:",
            (DiffTarget::WorkingTree { .. }, Some(false)) => "unstaged:",
            _ => "",
        };
        let mut readings = Vec::new();
        if file.additions > 0 {
            readings.push((SharedString::from(format!("+{}", file.additions)), Tone::Added));
        }
        if file.deletions > 0 {
            readings.push((SharedString::from(format!("-{}", file.deletions)), Tone::Deleted));
        }
        let mut trailing = readings.clone();
        if let Some(old) = &file.old_path {
            trailing.insert(0, (format!("from {old}").into(), Tone::Subtle));
        }
        Section {
            key: format!("{side}{}:{index}", file.path).into(),
            path: file.path.clone().into(),
            icon_path: None,
            tone: match file.status {
                FileStatus::Added => Tone::Added,
                FileStatus::Deleted => Tone::Deleted,
                FileStatus::Renamed => Tone::Renamed,
                FileStatus::Modified => Tone::Modified,
            },
            metadata: readings,
            trailing,
            rows: self.file_ranges.get(index).map_or(0, |range| range.len()),
        }
    }

    /// The list entry that shows a row, when its file is open.
    fn entry_of_row(&self, row: usize) -> Option<usize> {
        let file = self.rows.get(row)?.file();
        let range = self.file_ranges.get(file)?;
        self.multibuffer.index_of(file, row - range.start)
    }

    fn row_of_entry(&self, entry: usize) -> Option<usize> {
        match self.multibuffer.entry(entry)? {
            Entry::Row(file, row) => Some(self.file_ranges.get(file)?.start + row),
            Entry::Header(file) => self.file_ranges.get(file).map(|range| range.start),
            Entry::Footer => None,
        }
    }

    /// Opens a row's file if it is collapsed and scrolls the row into view.
    fn reveal(&mut self, row: usize, to_top: bool) {
        let Some(file) = self.rows.get(row).map(Row::file) else { return };
        let start = self.file_ranges[file].start;
        self.multibuffer.set_collapsed(file, false);
        if let Some(entry) = self.entry_of_row(row) {
            if to_top {
                self.multibuffer.list().scroll_to(ListOffset { item_ix: entry, offset_in_item: px(0.) });
            } else {
                self.multibuffer.reveal_row(file, row - start);
            }
        }
    }

    pub fn set_layout(&mut self, layout: Layout, cx: &mut Context<Self>) {
        if self.layout == layout {
            return;
        }
        self.layout = layout;
        // Remembered for the next diff, as Athas keeps `gitDefaultDiffView`.
        if cx.has_global::<settings::SettingsStore>() {
            settings::update(cx, |settings| settings.git_default_diff_view = layout.setting().to_string());
        }
        let hunk = self.current_hunk.and_then(|row| self.hunk_at(row));
        self.rebuild();
        self.current_hunk = hunk.and_then(|hunk| self.row_of_hunk(hunk));
        cx.notify();
    }

    fn hunk_at(&self, row: usize) -> Option<(usize, usize)> {
        match self.rows.get(row)? {
            Row::Hunk { file, hunk } => Some((*file, *hunk)),
            _ => None,
        }
    }

    fn row_of_hunk(&self, (file, hunk): (usize, usize)) -> Option<usize> {
        self.rows.iter().position(|row| *row == Row::Hunk { file, hunk })
    }

    /// Moves to the next (or previous) hunk and scrolls it to the top.
    pub fn step_hunk(&mut self, forward: bool, cx: &mut Context<Self>) {
        let from = self.current_hunk.or_else(|| {
            // Without a current hunk, start from what is on screen.
            let top = self.multibuffer.list().logical_scroll_top().item_ix;
            let row = self.row_of_entry(top)?;
            (top > 0).then(|| if forward { row.saturating_sub(1) } else { row })
        });
        if let Some(row) = model::step_hunk(&self.hunk_rows, from, forward) {
            self.current_hunk = Some(row);
            self.reveal(row, true);
            cx.notify();
        }
    }

    fn toggle(&mut self, change: impl FnOnce(&mut Folds), cx: &mut Context<Self>) {
        change(&mut self.folds);
        self.rebuild();
        cx.notify();
    }

    fn toggle_hunk(&mut self, file: usize, hunk: usize, cx: &mut Context<Self>) {
        self.toggle(|folds| {
            if !folds.collapsed_hunks.remove(&(file, hunk)) {
                folds.collapsed_hunks.insert((file, hunk));
            }
        }, cx);
    }

    fn set_all_files_collapsed(&mut self, collapsed: bool, cx: &mut Context<Self>) {
        self.multibuffer.set_all_collapsed(collapsed);
        cx.notify();
    }

    // Search.

    fn toggle_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_some() {
            self.close_find(window, cx);
            return;
        }
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Search changes").appearance(InputAppearance::Bare).leading_icon(IconName::Search));
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(text) => {
                if let Some(find) = &mut this.find {
                    find.query = text.to_string();
                    find.current = None;
                }
                this.refresh_find();
                this.step_find(true, cx);
            }
            TextInputEvent::Confirmed => this.step_find(true, cx),
            TextInputEvent::Cancelled => this.close_find(window, cx),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.find = Some(FindBar { input, query: String::new(), options: FindOptions::default(), matches: Vec::new(), current: None, invalid: false, _subscription: subscription });
        cx.notify();
    }

    /// Opens the search on `query` and goes to its first match.
    pub fn search_for(&mut self, query: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_none() {
            self.toggle_find(window, cx);
        }
        if let Some(find) = &self.find {
            find.input.update(cx, |input, cx| input.set_text(query.to_string(), cx));
        }
    }

    fn close_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.find = None;
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    fn refresh_find(&mut self) {
        let Some(find) = &mut self.find else { return };
        match find_regex(&find.query, find.options) {
            None => {
                find.matches.clear();
                find.invalid = false;
            }
            Some(Err(_)) => {
                find.matches.clear();
                find.invalid = true;
            }
            Some(Ok(regex)) => {
                find.matches = find_matches(&self.rows, &regex);
                find.invalid = false;
            }
        }
        if find.current.is_some_and(|current| current >= find.matches.len()) {
            find.current = None;
        }
    }

    fn step_find(&mut self, forward: bool, cx: &mut Context<Self>) {
        let Some(find) = &mut self.find else { return };
        let count = find.matches.len();
        if count == 0 {
            cx.notify();
            return;
        }
        let next = match (find.current, forward) {
            (None, true) => 0,
            (None, false) => count - 1,
            (Some(current), true) => (current + 1) % count,
            (Some(current), false) => (current + count - 1) % count,
        };
        find.current = Some(next);
        let row = find.matches[next].row;
        self.reveal(row, false);
        cx.notify();
    }

    fn set_find_option(&mut self, change: fn(&mut FindOptions), cx: &mut Context<Self>) {
        if let Some(find) = &mut self.find {
            change(&mut find.options);
            find.current = None;
        }
        self.refresh_find();
        self.step_find(true, cx);
    }

    /// The search highlights in one side of a row: the ranges and whether each is the current.
    fn find_ranges(&self, row: usize, side: u8) -> Vec<(Range<usize>, bool)> {
        let Some(find) = &self.find else { return Vec::new() };
        let start = find.matches.partition_point(|found| found.row < row);
        find.matches[start..]
            .iter()
            .enumerate()
            .take_while(|(_, found)| found.row == row)
            .filter(|(_, found)| found.side == side)
            .map(|(offset, found)| (found.range.clone(), find.current == Some(start + offset)))
            .collect()
    }

    fn open_file(&self, file: usize, line: Option<u32>, cx: &mut App) {
        let Some(file) = self.files.get(file) else { return };
        workbench_api::open_file(cx, self.root.join(&file.path), line);
    }

    /// The commit a commit diff shows, whose files open as they were then.
    fn commit_hash(&self) -> Option<&str> {
        match &self.target {
            DiffTarget::Commit { commit } | DiffTarget::CommitFile { commit, .. } => Some(commit),
            _ => None,
        }
    }

    fn open_file_at_commit(&self, file: usize, cx: &mut App) {
        let (Some(commit), Some(file)) = (self.commit_hash(), self.files.get(file)) else { return };
        crate::open_file_at_commit(cx, Some(&self.root), commit, &file.path);
    }

    fn on_find(&mut self, _: &Find, window: &mut Window, cx: &mut Context<Self>) {
        self.toggle_find(window, cx);
    }

    fn on_find_next(&mut self, _: &FindNext, _: &mut Window, cx: &mut Context<Self>) {
        self.step_find(true, cx);
    }

    fn on_find_previous(&mut self, _: &FindPrevious, _: &mut Window, cx: &mut Context<Self>) {
        self.step_find(false, cx);
    }

    fn run_hunk_action(&mut self, file: usize, hunk: usize, action: HunkAction, cx: &mut Context<Self>) {
        let Some(diff) = self.files.get(file).cloned() else { return };
        let Some(hunk) = diff.hunks().get(hunk).cloned() else { return };
        let target = self.target.clone();
        self.run(
            move |root| {
                // The diff on screen may be older than the file (edited and saved since, staged
                // in the panel): a hunk that is no longer in the current diff would put stale
                // lines into the index or the file.
                let current = match target {
                    DiffTarget::WorkingTree { scope } => git::load_working_tree(&root, scope)?.into_iter().map(|(_, file)| file).collect::<Vec<_>>(),
                    target => git::load(&root, &target)?,
                };
                let still_there = current.iter().any(|file| file.path == diff.path && file.hunks().contains(&hunk));
                if !still_there {
                    anyhow::bail!("The file changed since this diff was shown. It was read again; try once more.");
                }
                git::apply_hunk(&root, &diff, &hunk, action)
            },
            cx,
        );
    }

    fn set_file_staged(&mut self, file: usize, staged: bool, cx: &mut Context<Self>) {
        let Some(diff) = self.files.get(file).cloned() else { return };
        self.run(move |root| git::set_file_staged(&root, &diff, staged), cx);
    }

    /// Runs a change to the repository off the UI thread, then reads the diff again.
    fn run(&mut self, work: impl FnOnce(PathBuf) -> anyhow::Result<()> + Send + 'static, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.error = None;
        cx.notify();
        let root = self.root.clone();
        let task = cx.background_spawn(async move { work(root) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy = false;
                if let Err(error) = result {
                    this.error = Some(format!("{error:#}").into());
                }
                this.load(cx);
            })
            .ok();
        })
        .detach();
    }

    fn confirm_discard(&mut self, file: usize, hunk: usize, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity().downgrade();
        let entries = vec![
            MenuEntry::Label("Discard this hunk? This can't be undone.".into()),
            MenuItem::new("Discard hunk")
                .icon(IconName::Trash)
                .destructive()
                .on_select(move |_, cx| {
                    this.update(cx, |this, cx| this.run_hunk_action(file, hunk, HunkAction::Discard, cx)).ok();
                })
                .into(),
        ];
        self.open_menu = Some(OpenMenu::new("discard-hunk", entries, position, Anchor::TopRight, window, cx, |this: &mut Self, _| {
            this.open_menu = None
        }));
        cx.notify();
    }

    fn on_next_hunk(&mut self, _: &NextHunk, _: &mut Window, cx: &mut Context<Self>) {
        self.step_hunk(true, cx);
    }

    fn on_previous_hunk(&mut self, _: &PreviousHunk, _: &mut Window, cx: &mut Context<Self>) {
        self.step_hunk(false, cx);
    }

    fn on_toggle_layout(&mut self, _: &ToggleLayout, _: &mut Window, cx: &mut Context<Self>) {
        let next = if self.layout == Layout::Unified { Layout::Split } else { Layout::Unified };
        self.set_layout(next, cx);
    }

    fn on_reload(&mut self, _: &Reload, _: &mut Window, cx: &mut Context<Self>) {
        self.load(cx);
    }

    fn on_copy_selection(&mut self, _: &CopySelection, _: &mut Window, cx: &mut Context<Self>) {
        let Some(selection) = self.text_selection.filter(|selection| !selection.is_empty()) else { return };
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(crate::selection::selected_text(&self.rows, &selection)));
    }

    fn on_select_all_lines(&mut self, _: &SelectAllLines, _: &mut Window, cx: &mut Context<Self>) {
        self.text_selection = crate::selection::select_all(&self.rows);
        cx.notify();
    }

    /// Starts, extends (with shift) or drags the text selection to `drawn`, a byte of the text
    /// drawn in `row`'s cell on `side`.
    fn select_text(&mut self, row: usize, side: u8, drawn: usize, phase: SelectPhase, cx: &mut Context<Self>) {
        let Some(cell) = crate::selection::cell_at(&self.rows, row, side) else { return };
        let raw = cell.text.strip_suffix('\r').unwrap_or(&cell.text);
        let point = TextPoint { row, offset: crate::selection::raw_offset(raw, drawn, self.show_whitespace) };
        match phase {
            SelectPhase::Start { extend: true } if self.text_selection.is_some_and(|selection| selection.side == side) => {
                if let Some(selection) = &mut self.text_selection {
                    selection.head = point;
                    selection.selecting = true;
                }
            }
            SelectPhase::Start { .. } => self.text_selection = Some(TextSelection::at(side, point)),
            SelectPhase::Drag => match &mut self.text_selection {
                Some(selection) if selection.selecting && selection.side == side => selection.head = point,
                _ => return,
            },
        }
        cx.notify();
    }

    fn totals(&self) -> (usize, usize) {
        self.files.iter().fold((0, 0), |(added, removed), file| (added + file.additions, removed + file.deletions))
    }

    // Drawing.

    fn render_header(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Header {
        let (additions, deletions) = self.totals();
        let title: AnyElement = match (self.target.path(), self.files.first()) {
            (Some(path), file) => {
                let (name, dir) = match path.rsplit_once('/') {
                    Some((dir, name)) => (name.to_string(), dir.to_string()),
                    None => (path.to_string(), String::new()),
                };
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .children(file.map(|file| status_badge(file.status, colors)))
                    .child(div().flex_none().font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
                    .when(!dir.is_empty(), |this| this.child(div().min_w_0().truncate().text_color(colors.subtle_foreground).child(dir)))
                    .children(file.and_then(|file| file.old_path.clone()).map(|old| {
                        div().min_w_0().truncate().text_color(colors.subtle_foreground).child(format!("← {old}"))
                    }))
                    .when_some(self.side_label(), |this, label| this.child(div().flex_none().text_color(colors.subtle_foreground).child(label)))
                    .into_any_element()
            }
            (None, _) => match &self.commit {
                Some((summary, author, email)) => div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(6.))
                    .child(ui::Avatar::new(author).size(px(18.)).image(crate::avatar::author_avatar(email, cx)))
                    .child(div().min_w_0().truncate().child(summary.clone()))
                    .into_any_element(),
                None => div().min_w_0().truncate().child(self.target.title()).into_any_element(),
            },
        };

        let hunk_count = self.hunk_rows.len();
        let position = self.current_hunk.and_then(|row| self.hunk_rows.iter().position(|&hunk| hunk == row));
        let mut actions: Vec<AnyElement> = Vec::new();
        if hunk_count > 0 {
            actions.push(
                div()
                    .px(px(4.))
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.subtle_foreground)
                    .child(match position {
                        Some(index) => format!("{} of {}", index + 1, model_plural(hunk_count, "hunk")),
                        None => model_plural(hunk_count, "hunk"),
                    })
                    .into_any_element(),
            );
            actions.push(
                Button::icon("diff-prev-hunk", IconName::ChevronUp)
                    .size(ButtonSize::Small)
                    .tooltip("Previous hunk")
                    .shortcut("⌥↑")
                    .on_click(cx.listener(|this, _, _, cx| this.step_hunk(false, cx)))
                    .into_any_element(),
            );
            actions.push(
                Button::icon("diff-next-hunk", IconName::ChevronDown)
                    .size(ButtonSize::Small)
                    .tooltip("Next hunk")
                    .shortcut("⌥↓")
                    .on_click(cx.listener(|this, _, _, cx| this.step_hunk(true, cx)))
                    .into_any_element(),
            );
            actions.push(separator(colors));
        }
        if self.multi_file() && self.files.len() > 1 {
            actions.push(
                Button::icon("diff-expand-all", IconName::ArrowsOut)
                    .size(ButtonSize::Small)
                    .tooltip("Expand all")
                    .on_click(cx.listener(|this, _, _, cx| this.set_all_files_collapsed(false, cx)))
                    .into_any_element(),
            );
            actions.push(
                Button::icon("diff-collapse-all", IconName::ArrowsIn)
                    .size(ButtonSize::Small)
                    .tooltip("Collapse all")
                    .on_click(cx.listener(|this, _, _, cx| this.set_all_files_collapsed(true, cx)))
                    .into_any_element(),
            );
            actions.push(separator(colors));
        }
        for (layout, icon, tooltip) in [(Layout::Unified, IconName::Rows, "Unified view"), (Layout::Split, IconName::Columns, "Split view")] {
            actions.push(
                Button::icon(SharedString::from(format!("diff-layout-{}", layout.setting())), icon)
                    .size(ButtonSize::Small)
                    .active(self.layout == layout)
                    .tooltip(tooltip)
                    .on_click(cx.listener(move |this, _, _, cx| this.set_layout(layout, cx)))
                    .into_any_element(),
            );
        }
        actions.push(
            Button::icon("diff-search", IconName::Search)
                .size(ButtonSize::Small)
                .active(self.find.is_some())
                .tooltip("Search changes")
                .on_click(cx.listener(|this, _, window, cx| this.toggle_find(window, cx)))
                .into_any_element(),
        );
        actions.push(
            Button::icon("diff-actions", IconName::Dots)
                .size(ButtonSize::Small)
                .tooltip("Diff actions")
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                    let position = event.position();
                    this.show_actions_menu(point(position.x, position.y + px(8.)), window, cx)
                }))
                .into_any_element(),
        );
        if let (Some(_), Some(file)) = (self.target.path(), self.files.first()) {
            actions.push(separator(colors));
            match self.target {
                DiffTarget::Working { .. } => actions.push(
                    Button::new("diff-stage-file", "Stage file")
                        .leading_icon(IconName::Plus)
                        .size(ButtonSize::Small)
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, _, cx| this.set_file_staged(0, true, cx)))
                        .into_any_element(),
                ),
                DiffTarget::Staged { .. } => actions.push(
                    Button::new("diff-unstage-file", "Unstage file")
                        .leading_icon(IconName::Minus)
                        .size(ButtonSize::Small)
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, _, cx| this.set_file_staged(0, false, cx)))
                        .into_any_element(),
                ),
                _ => {}
            }
            if file.status != model::FileStatus::Deleted {
                actions.push(
                    Button::icon("diff-open-file", IconName::FileText)
                        .size(ButtonSize::Small)
                        .tooltip("Open file")
                        .on_click(cx.listener(|this, _, _, cx| this.open_file(0, None, cx)))
                        .into_any_element(),
                );
            }
        }
        actions.push(
            Button::icon("diff-reload", IconName::ArrowClockwise)
                .size(ButtonSize::Small)
                .tooltip("Reload")
                .on_click(cx.listener(|this, _, _, cx| this.load(cx)))
                .into_any_element(),
        );

        let mut detail = div().flex().items_center().gap(px(6.));
        if let DiffTarget::Commit { commit } = &self.target {
            detail = detail.child(div().font_family(typography::MONO_FONT).child(crate::target::short_hash(commit).to_string()));
        }
        if self.multi_file() {
            detail = detail.child(format!("{} changed file{}", self.files.len(), if self.files.len() == 1 { "" } else { "s" }));
        }
        let detail = detail.children(diff_numbers(additions, deletions, colors));
        Header {
            icon: Some(if matches!(self.target, DiffTarget::Commit { .. } | DiffTarget::CommitFile { .. }) { IconName::GitCommit } else { IconName::GitBranch }),
            title,
            detail: Some(detail.into_any_element()),
            actions,
        }
    }

    fn show_actions_menu(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity().downgrade();
        let mut entries: Vec<MenuEntry> = Vec::new();
        let active = self.multibuffer.top_section().or_else(|| (self.files.len() == 1).then_some(0));
        if let (Some(commit), Some(file)) = (self.commit_hash(), active.filter(|&file| self.files.get(file).is_some_and(|file| file.status != model::FileStatus::Deleted))) {
            let view = this.clone();
            entries.push(
                MenuItem::new(format!("Open file at {}", crate::target::short_hash(commit)))
                    .on_select(move |_, cx| {
                        view.update(cx, |this, cx| this.open_file_at_commit(file, cx)).ok();
                    })
                    .into(),
            );
        }
        if let Some(url) = self.github_url.clone() {
            entries.push(MenuItem::new("View on GitHub").icon(IconName::Github).on_select(move |_, cx| cx.open_url(&url)).into());
        }
        entries.push(
            MenuItem::new(if self.show_whitespace { "Hide whitespace" } else { "Show whitespace" })
                .on_select(move |_, cx| {
                    this.update(cx, |this, cx| {
                        this.show_whitespace = !this.show_whitespace;
                        cx.notify();
                    })
                    .ok();
                })
                .into(),
        );
        self.open_menu = Some(OpenMenu::new("diff-actions", entries, position, Anchor::TopRight, window, cx, |this: &mut Self, _| this.open_menu = None));
        cx.notify();
    }

    fn side_label(&self) -> Option<String> {
        match &self.target {
            DiffTarget::Working { .. } => Some("Working tree".into()),
            DiffTarget::Staged { .. } => Some("Staged".into()),
            DiffTarget::CommitFile { commit, .. } => Some(format!("at {}", crate::target::short_hash(commit))),
            _ => None,
        }
    }

    fn render_entry(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        match self.multibuffer.entry(index) {
            Some(Entry::Header(file)) => self.render_file_header(file, cx),
            Some(Entry::Row(file, row)) => match self.file_ranges.get(file) {
                Some(range) => self.render_row(range.start + row, cx),
                None => div().into_any_element(),
            },
            _ => div().into_any_element(),
        }
    }

    fn render_row(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(row) = self.rows.get(index).cloned() else { return div().into_any_element() };
        match row {
            Row::File { .. } => div().into_any_element(),
            Row::Hunk { file, hunk } => self.render_hunk_header(index, file, hunk, &colors, cx),
            Row::Gap { file, gap, lines } => self.render_gap(file, gap, lines, &colors, cx),
            Row::Line { file, cell, .. } => self.render_unified_line(index, file, &cell, &colors, cx),
            Row::Split { file, left, right, .. } => self.render_split_line(index, file, left.as_ref(), right.as_ref(), &colors, cx),
            Row::Notice { file, notice } => self.render_notice(file, notice, &colors, cx),
        }
    }

    /// A file's multibuffer header; its name opens the file when the diff's new side is on disk.
    fn render_file_header(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let Some(file) = self.files.get(index) else { return div().into_any_element() };
        let deleted = file.status == model::FileStatus::Deleted;
        let open: Option<multibuffer::OpenHandler<Self>> = if !deleted && self.target.is_editable() {
            Some(Rc::new(move |this: &mut Self, _: &mut Window, cx: &mut Context<Self>| this.open_file(index, None, cx)))
        } else if !deleted && self.commit_hash().is_some() {
            Some(Rc::new(move |this: &mut Self, _: &mut Window, cx: &mut Context<Self>| this.open_file_at_commit(index, cx)))
        } else {
            None
        };
        self.multibuffer.render_header(index, Vec::new(), open, cx)
    }

    fn render_hunk_header(&self, row: usize, file_index: usize, hunk_index: usize, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let Some(file) = self.files.get(file_index) else { return div().into_any_element() };
        let Some(hunk) = file.hunks().get(hunk_index) else { return div().into_any_element() };
        let collapsed = self.folds.collapsed_hunks.contains(&(file_index, hunk_index));
        let current = self.current_hunk == Some(row);
        let (additions, deletions) = hunk.counts();
        let accent = colors.accent;
        let range = format!("-{} +{}", hunk.old_start, hunk.new_start);
        let line = hunk.first_changed_line();
        let file_target = self.file_target(file_index);
        let mut actions: Vec<AnyElement> = Vec::new();
        let button = |id: &str, icon: IconName, label: &str| {
            Button::new(SharedString::from(format!("{id}-{file_index}-{hunk_index}")), label.to_string())
                .leading_icon(icon)
                .size(ButtonSize::XSmall)
                .variant(ButtonVariant::Ghost)
                .disabled(self.busy)
        };
        if git::allows(&file_target, file, HunkAction::Stage) {
            actions.push(
                button("stage-hunk", IconName::Plus, "Stage")
                    .tone(ButtonTone::Success)
                    .tooltip("Stage hunk")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        cx.stop_propagation();
                        this.run_hunk_action(file_index, hunk_index, HunkAction::Stage, cx)
                    }))
                    .into_any_element(),
            );
        }
        if git::allows(&file_target, file, HunkAction::Unstage) {
            actions.push(
                button("unstage-hunk", IconName::Minus, "Unstage")
                    .tone(ButtonTone::Danger)
                    .tooltip("Unstage hunk")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        cx.stop_propagation();
                        this.run_hunk_action(file_index, hunk_index, HunkAction::Unstage, cx)
                    }))
                    .into_any_element(),
            );
        }
        if git::allows(&file_target, file, HunkAction::Discard) {
            actions.push(
                button("discard-hunk", IconName::ArrowCounterClockwise, "Discard")
                    .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                        cx.stop_propagation();
                        let position = event.position();
                        this.confirm_discard(file_index, hunk_index, point(position.x, position.y + px(8.)), window, cx)
                    }))
                    .into_any_element(),
            );
        }
        if file.status != model::FileStatus::Deleted && matches!(file_target, DiffTarget::Working { .. } | DiffTarget::Staged { .. }) {
            actions.push(
                Button::icon(SharedString::from(format!("open-hunk-{file_index}-{hunk_index}")), IconName::FileText)
                    .size(ButtonSize::XSmall)
                    .tooltip(format!("Open at line {line}"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        cx.stop_propagation();
                        this.open_file(file_index, Some(line), cx);
                    }))
                    .into_any_element(),
            );
        }
        div()
            .id(SharedString::from(format!("hunk-{file_index}-{hunk_index}")))
            .flex()
            .items_center()
            .w_full()
            .h(px(32.))
            .pr(px(8.))
            .gap(px(8.))
            .bg(if current { colors.selected } else { colors.surface })
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_SM)
            .text_color(colors.subtle_foreground)
            .hover(move |style| style.bg(accent))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .w(NUMBER_WIDTH)
                    .justify_center()
                    .child(Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown }).size(IconSize::XSmall).color(colors.subtle_foreground)),
            )
            .when(collapsed, |this| {
                this.child(
                    div()
                        .flex_none()
                        .px(px(6.))
                        .rounded(ui::metrics::RADIUS_MD)
                        .bg(colors.accent)
                        .text_color(colors.muted_foreground)
                        .child(format!("{} hidden", hunk.lines.len())),
                )
            })
            .child(div().flex_none().child(range))
            .child(div().flex_1().min_w_0().truncate().text_color(colors.muted_foreground).child(hunk.context().to_string()))
            .children(diff_numbers(additions, deletions, colors))
            .child(div().flex().flex_none().items_center().gap(px(2.)).font_family(typography::UI_FONT).children(actions))
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_hunk(file_index, hunk_index, cx)))
            .into_any_element()
    }

    fn render_gap(&self, file: usize, gap: usize, lines: u32, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let accent = colors.accent;
        let hover = colors.foreground;
        div()
            .id(SharedString::from(format!("gap-{file}-{gap}")))
            .flex()
            .items_center()
            .gap(px(8.))
            .w_full()
            .h(px(24.))
            .bg(colors.surface)
            .text_size(typography::TEXT_CAPTION)
            .text_color(colors.subtle_foreground)
            .hover(move |style| style.bg(accent).text_color(hover))
            .child(div().flex().flex_none().w(NUMBER_WIDTH).justify_center().child(Icon::new(IconName::ChevronExpandY).size(IconSize::XSmall).color(colors.subtle_foreground)))
            .child(format!("{} unchanged {}", lines, if lines == 1 { "line" } else { "lines" }))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.toggle(|folds| {
                    folds.expanded_gaps.insert((file, gap));
                }, cx)
            }))
            .into_any_element()
    }

    /// The line number in the gutter; clicking opens the file there.
    fn number(&self, id: ElementId, file: usize, value: Option<u32>, open_at: Option<u32>, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let hover = colors.foreground;
        let clickable = open_at.is_some() && self.can_open_lines(file);
        div()
            .id(id)
            .flex_none()
            .w(NUMBER_WIDTH)
            .pr(px(8.))
            .text_right()
            .text_color(colors.subtle_foreground)
            .children(value.map(|value| value.to_string()))
            .when(clickable, |this| {
                this.hover(move |style| style.text_color(hover)).on_click(cx.listener(move |this, _, _, cx| this.open_file(file, open_at, cx)))
            })
            .into_any_element()
    }

    /// Lines open the file in the working tree, which matches the diff's new side only for
    /// working and staged diffs.
    fn can_open_lines(&self, file: usize) -> bool {
        self.target.is_editable() && self.files.get(file).is_some_and(|file| file.status != model::FileStatus::Deleted)
    }

    fn line_colors(kind: LineKind, colors: &ThemeColors) -> (Option<Hsla>, Hsla, &'static str, Hsla) {
        match kind {
            LineKind::Added => (Some(colors.git_added.opacity(0.12)), colors.git_added.opacity(0.32), "+", colors.git_added),
            LineKind::Removed => (Some(colors.git_deleted.opacity(0.12)), colors.git_deleted.opacity(0.32), "-", colors.git_deleted),
            _ => (None, colors.accent, " ", colors.subtle_foreground),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn text(&self, row: usize, side: u8, cell: &Cell, word_bg: Hsla, found: Vec<(Range<usize>, bool)>, syntax: Vec<(Range<usize>, Hsla)>, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let raw = cell.text.strip_suffix('\r').unwrap_or(&cell.text);
        let selected = self.text_selection.and_then(|selection| selection.range_in(row, side, raw.len()));
        let found_ranges: Vec<Range<usize>> = found.iter().map(|(range, _)| range.clone()).collect();
        let draw = |ranges: &[Range<usize>]| if self.show_whitespace { visible_whitespace(raw, ranges) } else { display_text(raw, ranges) };
        let (text, ranges) = draw(&cell.words);
        let (_, found_ranges) = draw(&found_ranges);
        let mut highlights: Vec<_> = ranges.into_iter().map(|range| (range, HighlightStyle { background_color: Some(word_bg), ..Default::default() })).collect();
        if !found_ranges.is_empty() {
            let currents: Vec<bool> = found.iter().filter(|(range, _)| !range.is_empty()).map(|(_, current)| *current).collect();
            let found: Vec<_> = found_ranges
                .into_iter()
                .zip(currents)
                .map(|(range, current)| (range, HighlightStyle { background_color: Some(colors.warning.opacity(if current { 0.7 } else { 0.3 })), ..Default::default() }))
                .collect();
            highlights = merge_highlights(highlights, found);
        }
        if !syntax.is_empty() {
            let syntax: Vec<(Range<usize>, Hsla)> =
                syntax.into_iter().filter_map(|(range, color)| draw(std::slice::from_ref(&range)).1.into_iter().next().map(|range| (range, color))).collect();
            highlights = crate::highlight::layer(&syntax, &highlights);
        }
        if let Some(selected) = selected {
            let selected = draw(std::slice::from_ref(&selected)).1;
            let selected = selected.into_iter().map(|range| (range, HighlightStyle { background_color: Some(colors.selection), ..Default::default() })).collect();
            highlights = merge_highlights(highlights, selected);
        }
        let text = if text.is_empty() { " ".to_string() } else { text };
        let styled = StyledText::new(text).with_highlights(highlights);
        let (down, moved) = (styled.layout().clone(), styled.layout().clone());
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .items_center()
            .overflow_hidden()
            .pr(px(16.))
            .text_color(colors.foreground)
            .cursor(gpui::CursorStyle::IBeam)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, event: &gpui::MouseDownEvent, _, cx| {
                    let drawn = down.index_for_position(event.position).unwrap_or_else(|index| index);
                    this.select_text(row, side, drawn, SelectPhase::Start { extend: event.modifiers.shift }, cx);
                }),
            )
            .on_mouse_move(cx.listener(move |this, event: &gpui::MouseMoveEvent, _, cx| {
                if event.pressed_button != Some(MouseButton::Left) {
                    return;
                }
                let drawn = moved.index_for_position(event.position).unwrap_or_else(|index| index);
                this.select_text(row, side, drawn, SelectPhase::Drag, cx);
            }))
            .child(styled)
            .into_any_element()
    }

    fn line_base(colors: &ThemeColors) -> gpui::Div {
        div()
            .flex()
            .items_center()
            .h(LINE_HEIGHT)
            .w_full()
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_SM)
            .line_height(relative(1.5))
            .whitespace_nowrap()
            .text_color(colors.foreground)
    }

    fn render_unified_line(&self, row: usize, file: usize, cell: &Cell, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let (bg, word_bg, sign, sign_color) = Self::line_colors(cell.kind, colors);
        let open_at = cell.new.or(cell.old);
        Self::line_base(colors)
            .when_some(bg, |this, bg| this.bg(bg))
            .child(self.number(ElementId::NamedInteger("old".into(), row as u64), file, cell.old, open_at, colors, cx))
            .child(self.number(ElementId::NamedInteger("new".into(), row as u64), file, cell.new, open_at, colors, cx))
            .child(div().flex_none().w(px(16.)).text_color(sign_color).child(sign))
            .child(self.text(row, 0, cell, word_bg, self.find_ranges(row, 0), self.syntax_colors(file, cell, false, cx), colors, cx))
            .into_any_element()
    }

    fn render_split_line(&self, row: usize, file: usize, left: Option<&Cell>, right: Option<&Cell>, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let side = |this: &Self, id: &'static str, cell: Option<&Cell>, old_side: bool, cx: &mut Context<Self>| -> AnyElement {
            let half = div().flex().flex_1().min_w_0().h_full().items_center().overflow_hidden();
            match cell {
                Some(cell) => {
                    let (bg, word_bg, sign, sign_color) = Self::line_colors(cell.kind, colors);
                    let number = if old_side { cell.old } else { cell.new };
                    let open_at = if old_side { None } else { cell.new };
                    half.when_some(bg, |this, bg| this.bg(bg))
                        .child(this.number(ElementId::NamedInteger(id.into(), row as u64), file, number, open_at, colors, cx))
                        .child(div().flex_none().w(px(16.)).text_color(sign_color).child(if cell.kind == LineKind::Context { " " } else { sign }))
                        .child(this.text(row, if old_side { 0 } else { 1 }, cell, word_bg, this.find_ranges(row, if old_side { 0 } else { 1 }), this.syntax_colors(file, cell, old_side, cx), colors, cx))
                        .into_any_element()
                }
                None => half.bg(colors.surface.opacity(0.6)).into_any_element(),
            }
        };
        Self::line_base(colors)
            .child(side(self, "left", left, true, cx))
            .child(div().flex_none().w(px(1.)).h_full().bg(colors.divider))
            .child(side(self, "right", right, false, cx))
            .into_any_element()
    }

    fn render_notice(&self, file: usize, notice: Notice, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let message = |text: &str| {
            div()
                .flex()
                .items_center()
                .justify_center()
                .h(px(56.))
                .text_size(typography::TEXT_SM)
                .text_color(colors.subtle_foreground)
                .child(text.to_string())
                .into_any_element()
        };
        match notice {
            Notice::Binary => message("Binary file not shown"),
            Notice::NoContent => message("No content changes"),
            Notice::Truncated => message(&format!("Diff truncated after {} lines to keep the view responsive", model::MAX_LINES)),
            Notice::Image => match self.files.get(file).map(|file| (&file.content, file.path.clone())) {
                Some((FileContent::Image { old, new }, path)) => div()
                    .flex()
                    .flex_col()
                    .child(self.render_zoom_bar(colors, cx))
                    .child(render_image_diff(&path, old.as_ref(), new.as_ref(), self.image_zoom, colors))
                    .into_any_element(),
                _ => message("Image not available"),
            },
        }
    }
}

/// Word highlights with search highlights over them: where they overlap the search one wins, as
/// StyledText needs ranges that do not overlap.
fn merge_highlights(words: Vec<(Range<usize>, HighlightStyle)>, found: Vec<(Range<usize>, HighlightStyle)>) -> Vec<(Range<usize>, HighlightStyle)> {
    let mut out: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
    for (range, style) in words {
        let mut pieces = vec![range];
        for (cut, _) in &found {
            pieces = pieces
                .into_iter()
                .flat_map(|piece| {
                    let before = piece.start..piece.end.min(cut.start);
                    let after = piece.start.max(cut.end)..piece.end;
                    [before, after].into_iter().filter(|part| part.start < part.end)
                })
                .collect();
        }
        out.extend(pieces.into_iter().map(|piece| (piece, style)));
    }
    out.extend(found);
    out.sort_by_key(|(range, _)| range.start);
    out
}

fn separator(colors: &ThemeColors) -> AnyElement {
    div().flex_none().w(px(1.)).h(px(16.)).mx(px(4.)).bg(colors.divider).into_any_element()
}

fn model_plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "s" })
}

fn format_bytes(bytes: usize) -> String {
    match bytes {
        0..1024 => format!("{bytes} B"),
        1024..1_048_576 => format!("{:.1} KB", bytes as f64 / 1024.),
        _ => format!("{:.1} MB", bytes as f64 / 1_048_576.),
    }
}

impl DiffView {
    /// Zoom out, the zoom level and zoom in over an image diff (`ImageDiffViewer`).
    fn render_zoom_bar(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let zoom = self.image_zoom;
        div()
            .flex()
            .items_center()
            .justify_end()
            .gap(px(4.))
            .px(px(12.))
            .pt(px(8.))
            .child(
                Button::icon("diff-image-zoom-out", IconName::ZoomOut)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .tooltip("Zoom out")
                    .disabled(zoom <= model::MIN_IMAGE_ZOOM)
                    .on_click(cx.listener(|this, _, _, cx| this.set_image_zoom(this.image_zoom - model::IMAGE_ZOOM_STEP, cx))),
            )
            .child(
                div()
                    .min_w(px(40.))
                    .text_center()
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.subtle_foreground)
                    .child(format!("{}%", (zoom * 100.).round())),
            )
            .child(
                Button::icon("diff-image-zoom-in", IconName::ZoomIn)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .tooltip("Zoom in")
                    .disabled(zoom >= model::MAX_IMAGE_ZOOM)
                    .on_click(cx.listener(|this, _, _, cx| this.set_image_zoom(this.image_zoom + model::IMAGE_ZOOM_STEP, cx))),
            )
            .into_any_element()
    }

    fn set_image_zoom(&mut self, zoom: f32, cx: &mut Context<Self>) {
        self.image_zoom = model::clamp_image_zoom(zoom);
        self.multibuffer.list().remeasure();
        cx.notify();
    }
}

fn zoomed_image(image: Arc<gpui::Image>, size: Option<(u32, u32)>, zoom: f32) -> AnyElement {
    let image = img(image).flex_none().object_fit(gpui::ObjectFit::Contain);
    match size {
        Some(size) => {
            let (width, height) = model::image_display_size(size, zoom);
            image.w(px(width)).h(px(height)).into_any_element()
        }
        None => image.max_w_full().max_h(px(model::IMAGE_MAX_HEIGHT * zoom)).into_any_element(),
    }
}

/// Before and after, side by side, with their sizes; as Athas's `git-diff-image`.
fn render_image_diff(path: &str, old: Option<&ImageSide>, new: Option<&ImageSide>, zoom: f32, colors: &ThemeColors) -> AnyElement {
    let format = git::image_format(path);
    let panel = |label: &'static str, side: Option<&ImageSide>, tone: Hsla| {
        let body: AnyElement = match (side, format) {
            (Some(side), Some(format)) => {
                let image = Arc::new(gpui::Image::from_bytes(format, side.bytes.as_ref().clone()));
                div()
                    .flex()
                    .flex_1()
                    .min_h(px(120.))
                    .items_center()
                    .justify_center()
                    .relative()
                    .p(px(12.))
                    .child(ui::checkerboard(colors))
                    .overflow_hidden()
                    .child(zoomed_image(image, side.size, zoom))
                    .into_any_element()
            }
            _ => div()
                .flex()
                .flex_1()
                .min_h(px(120.))
                .items_center()
                .justify_center()
                .text_size(typography::TEXT_SM)
                .text_color(colors.subtle_foreground)
                .child(if side.is_none() { "None" } else { "Preview not available" })
                .into_any_element(),
        };
        let detail = side.map(|side| match side.size {
            Some((width, height)) => format!("{width} × {height} · {}", format_bytes(side.bytes.len())),
            None => format_bytes(side.bytes.len()),
        });
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .rounded(ui::metrics::RADIUS_LG)
            .border_1()
            .border_color(colors.divider)
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(28.))
                    .px(px(10.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .text_size(typography::TEXT_CAPTION)
                    .child(div().font_weight(typography::MEDIUM).text_color(tone).child(label))
                    .children(detail.map(|detail| div().text_color(colors.subtle_foreground).child(detail))),
            )
            .child(body)
    };
    div()
        .flex()
        .gap(px(12.))
        .p(px(12.))
        .child(panel("Before", old, colors.git_deleted))
        .child(panel("After", new, colors.git_added))
        .into_any_element()
}

impl Render for DiffView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("git-diff-view")
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::on_next_hunk))
            .on_action(cx.listener(Self::on_previous_hunk))
            .on_action(cx.listener(Self::on_toggle_layout))
            .on_action(cx.listener(Self::on_reload))
            .on_action(cx.listener(Self::on_find))
            .on_action(cx.listener(Self::on_find_next))
            .on_action(cx.listener(Self::on_find_previous))
            .on_action(cx.listener(Self::on_copy_selection))
            .on_action(cx.listener(Self::on_select_all_lines))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, _| {
                if let Some(selection) = &mut this.text_selection {
                    selection.selecting = false;
                }
            }))
            .on_mouse_down(MouseButton::Left, cx.listener(|this, _, window, cx| window.focus(&this.focus_handle, cx)))
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground);
        let error = self.error.clone().map(|error| {
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .px(px(12.))
                .py(px(6.))
                .bg(colors.destructive_soft)
                .text_size(typography::TEXT_SM)
                .text_color(colors.destructive)
                .child(div().flex_1().min_w_0().child(error))
                .child(Button::icon("diff-error-close", IconName::X).size(ButtonSize::XSmall).on_click(cx.listener(|this, _, _, cx| {
                    this.error = None;
                    cx.notify();
                })))
        });
        let body = match &self.state {
            State::Loading => fill_message("Loading diff…", None, IconName::GitDiff, None),
            State::Failed(error) => fill_message(
                "Could not read the diff",
                Some(error.clone()),
                IconName::WarningCircle,
                Some(Button::new("diff-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element()),
            ),
            State::Ready => {
                let header = self.render_header(&colors, cx);
                let body = if self.files.is_empty() {
                    fill_message(
                        "No changes",
                        Some(match &self.target {
                            DiffTarget::Working { .. } => "This file has no unstaged changes.".into(),
                            DiffTarget::Staged { .. } => "This file has no staged changes.".into(),
                            DiffTarget::WorkingTree { scope } => format!("No {}.", scope.empty_label()).into(),
                            _ => "Nothing changed.".into(),
                        }),
                        IconName::CheckCircle,
                        None,
                    )
                } else {
                    let state = self.multibuffer.list().clone();
                    ui::with_scrollbar(
                        list(state.clone(), cx.processor(|this, index: usize, _window, cx| this.render_entry(index, cx))).flex_1().size_full(),
                        ui::Scrollbar::list("diff-scrollbar", &state),
                    )
                    .size_full()
                    .into_any_element()
                };
                let sticky = self.multibuffer.sticky_section().map(|file| self.render_file_header(file, cx));
                let overlay = self.render_find(&colors, cx);
                let surface = self.multibuffer.render(Some(header), body, sticky, overlay, cx);
                let banner = crate::diff_banner(&self.target, cx).map(|banner| banner(&self.target, window, cx));
                div().flex().flex_col().size_full().min_h_0().children(error).children(banner).child(surface).into_any_element()
            }
        };
        container.child(div().flex().flex_col().flex_1().min_h_0().child(body)).children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

impl DiffView {
    /// The search popover over the top right of the diff.
    fn render_find(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let find = self.find.as_ref()?;
        let theme = cx.theme().clone();
        let label = if find.query.is_empty() {
            None
        } else if find.invalid {
            Some("Invalid expression".to_string())
        } else if find.matches.is_empty() {
            Some("No results".to_string())
        } else {
            Some(match find.current {
                Some(current) => format!("{} of {}", current + 1, find.matches.len()),
                None => format!("{} results", find.matches.len()),
            })
        };
        let warn = find.invalid || (!find.query.is_empty() && find.matches.is_empty());
        let option = |id: &'static str, icon: IconName, tooltip: &'static str, active: bool, change: fn(&mut FindOptions), cx: &mut Context<Self>| {
            Button::icon(id, icon).size(ButtonSize::XSmall).active(active).tooltip(tooltip).on_click(cx.listener(move |this, _, _, cx| this.set_find_option(change, cx)))
        };
        let can_step = !find.matches.is_empty();
        Some(
            div()
                .absolute()
                .top(px(8.))
                .right(px(16.))
                .flex()
                .items_center()
                .gap(px(2.))
                .w(px(420.))
                .max_w_full()
                .h(px(32.))
                .pl(px(8.))
                .pr(px(4.))
                .rounded(ui::metrics::RADIUS_LG)
                .bg(colors.overlay)
                .border_1()
                .border_color(colors.border)
                .shadow(theme.shadows.popover.clone())
                .text_size(typography::TEXT_SM)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        // Shift-Enter goes back a match, as the original's search field.
                        .capture_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                            let keystroke = &event.keystroke;
                            if keystroke.key == "enter" && keystroke.modifiers.shift && !keystroke.modifiers.platform {
                                cx.stop_propagation();
                                this.step_find(false, cx);
                            }
                        }))
                        .child(find.input.clone()),
                )
                .children(label.map(|label| div().flex_none().px(px(4.)).text_size(typography::TEXT_CAPTION).text_color(if warn { colors.warning } else { colors.subtle_foreground }).child(label)))
                .child(option("diff-find-case", IconName::CaseSensitive, "Match case", find.options.case_sensitive, |options| options.case_sensitive = !options.case_sensitive, cx))
                .child(option("diff-find-word", IconName::Text, "Match whole word", find.options.whole_word, |options| options.whole_word = !options.whole_word, cx))
                .child(option("diff-find-regex", IconName::BracketsCurly, "Use regular expression", find.options.regex, |options| options.regex = !options.regex, cx))
                .child(Button::icon("diff-find-previous", IconName::ChevronUp).size(ButtonSize::XSmall).disabled(!can_step).tooltip("Previous match").on_click(cx.listener(|this, _, _, cx| this.step_find(false, cx))))
                .child(Button::icon("diff-find-next", IconName::ChevronDown).size(ButtonSize::XSmall).disabled(!can_step).tooltip("Next match").on_click(cx.listener(|this, _, _, cx| this.step_find(true, cx))))
                .child(Button::icon("diff-find-close", IconName::X).size(ButtonSize::XSmall).tooltip("Close").on_click(cx.listener(|this, _, window, cx| this.close_find(window, cx))))
                .into_any_element(),
        )
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn cell(kind: LineKind, text: &str) -> Cell {
        Cell { kind, old: Some(1), new: Some(1), text: text.into(), words: Vec::new() }
    }

    #[test]
    fn finds_matches_with_the_search_options() {
        let rows = vec![
            Row::Hunk { file: 0, hunk: 0 },
            Row::Line { file: 0, hunk: Some(0), cell: cell(LineKind::Removed, "let Value = value;") },
            Row::Split { file: 0, hunk: Some(0), left: Some(cell(LineKind::Context, "value")), right: Some(cell(LineKind::Context, "value")) },
            Row::Split { file: 0, hunk: Some(0), left: None, right: Some(cell(LineKind::Added, "values")) },
        ];
        let found = |query: &str, options: FindOptions| find_matches(&rows, &find_regex(query, options).unwrap().unwrap());
        let plain = found("value", FindOptions::default());
        assert_eq!(
            plain,
            [
                FindMatch { row: 1, side: 0, range: 4..9 },
                FindMatch { row: 1, side: 0, range: 12..17 },
                FindMatch { row: 2, side: 0, range: 0..5 },
                FindMatch { row: 3, side: 1, range: 0..5 },
            ]
        );
        assert_eq!(found("Value", FindOptions { case_sensitive: true, ..Default::default() }).len(), 1);
        assert_eq!(found("value", FindOptions { whole_word: true, ..Default::default() }).len(), 3);
        assert_eq!(found("val.e", FindOptions::default()).len(), 0);
        assert_eq!(found("val.e", FindOptions { regex: true, ..Default::default() }).len(), 4);
        assert!(find_regex("(", FindOptions { regex: true, ..Default::default() }).unwrap().is_err());
        assert!(find_regex("", FindOptions::default()).is_none());
    }

    #[test]
    fn search_highlights_cut_through_word_highlights() {
        let style = HighlightStyle::default();
        let merged = merge_highlights(vec![(0..10, style)], vec![(3..5, style)]);
        assert_eq!(merged.into_iter().map(|(range, _)| range).collect::<Vec<_>>(), [0..3, 3..5, 5..10]);
    }
}
