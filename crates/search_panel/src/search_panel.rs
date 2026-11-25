//! Project search (`features/global-search`): find text across the project, results grouped by
//! file with highlighted excerpts, and replace.

mod engine;
mod excerpt;
mod query;
#[cfg(not(target_family = "wasm"))]
mod remote;
mod replace;

use std::{
    collections::{HashMap, HashSet},
    ops::Range,
    rc::Rc,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use ui::scale::px;
use gpui::{
    AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, HighlightStyle, IntoElement,
    KeyDownEvent, ListOffset, Render, SharedString, StyledText, Subscription, Task, Window, div, list, prelude::*,
};
use multibuffer::{Entry, Multibuffer, OpenHandler, Section, Tone};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, InputAppearance, TextInput,
    TextInputEvent, metrics, typography,
};

pub use engine::{FileMatches, LineMatch, Page, index_files_changed};
pub use excerpt::{CONTEXT_LINES, EXPANDED_CONTEXT_LINES, ExcerptLine};
#[cfg(target_family = "wasm")]
pub use engine::{WebGrep, set_web_grep};
pub use query::{GrepPattern, PathFilter};
#[cfg(not(target_family = "wasm"))]
pub use remote::{RemoteShell, set_remote_shells};
use query::SearchOptions;

#[derive(Clone, Debug, PartialEq)]
pub enum SearchEvent {
    /// Open a result: the file, at a 1-based line.
    /// A file at a 1-based line and, for a match, its 1-based character column.
    OpenFile { path: PathBuf, line: Option<u32>, column: Option<u32> },
}

/// Typing settles for this long before a search starts.
const DEBOUNCE: Duration = Duration::from_millis(200);
/// Matches one search collects before it stops and offers to load more.
const MATCH_LIMIT: usize = 2000;
fn row_height() -> gpui::Pixels { px(24.) }
fn line_height() -> gpui::Pixels { px(20.) }
/// Files larger than this give no context lines.
#[cfg(not(target_family = "wasm"))]
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;

/// A match in the results, by file and match index; a search only appends, so a row keeps
/// meaning the same result while later pages arrive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Row {
    Match(usize, usize),
}

#[derive(Clone, Debug, PartialEq)]
enum Phase {
    Idle,
    Indexing,
    Searching,
    Done,
    Failed(String),
}

struct Notice {
    message: SharedString,
    error: bool,
}

pub struct SearchView {
    roots: Vec<PathBuf>,
    focus_handle: FocusHandle,
    index: Arc<engine::Index>,
    indexed: bool,
    query_input: Entity<TextInput>,
    replace_input: Entity<TextInput>,
    include_input: Entity<TextInput>,
    exclude_input: Entity<TextInput>,
    options: SearchOptions,
    details_visible: bool,
    /// The query the results are for.
    searched_query: String,
    /// The options `searched_query` was searched with: Replace matches with these, not with
    /// toggles changed since (a literal `a.b` turned regex would also replace `axb`).
    searched_options: SearchOptions,
    files: Vec<FileMatches>,
    multibuffer: Multibuffer<Self>,
    /// Each file's excerpt, and the excerpt line of each of its matches.
    excerpts: Vec<Vec<ExcerptLine>>,
    /// Syntax colours of each excerpt line (`use-search-excerpt-tokens.ts`).
    syntax: Vec<Vec<Vec<(Range<usize>, editor::SyntaxKind)>>>,
    match_lines: Vec<Vec<usize>>,
    /// The files' lines, for context; `None` when a file could not be read.
    sources: HashMap<PathBuf, Option<Arc<Vec<String>>>>,
    /// Files whose context is expanded.
    expanded: HashSet<PathBuf>,
    source_task: Option<Task<()>>,
    selected: Option<Row>,
    phase: Phase,
    next_offset: usize,
    /// Progress of the running search: files searched so far, of how many.
    searched_files: usize,
    searchable_files: usize,
    regex_warning: Option<String>,
    notice: Option<Notice>,
    confirm_replace_all: bool,
    replacing: bool,
    search_task: Option<Task<()>>,
    replace_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SearchEvent> for SearchView {}

impl Focusable for SearchView {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.query_input.focus_handle(cx)
    }
}

impl SearchView {
    pub fn new(roots: Vec<PathBuf>, query: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = |placeholder: &'static str, appearance, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder).appearance(appearance))
        };
        let query_input = input("Search in files...", InputAppearance::Bare, window, cx);
        let replace_input = input("Replace", InputAppearance::Field, window, cx);
        let include_input = input("Files to include", InputAppearance::Field, window, cx);
        let exclude_input = input("Files to exclude", InputAppearance::Field, window, cx);
        if let Some(query) = query.filter(|query| !query.is_empty()) {
            query_input.update(cx, |input, cx| input.set_text(query, cx));
        }

        let mut subscriptions = vec![
            // Escape clears the query, or leaves the field once it is empty (`use-keyboard-navigation`).
            cx.subscribe_in(&query_input, window, |this, input, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => this.search(true, false, cx),
                TextInputEvent::Confirmed => this.open_selected(cx),
                TextInputEvent::Cancelled => {
                    if input.read(cx).text().is_empty() {
                        window.focus(&this.focus_handle, cx);
                    } else {
                        input.update(cx, |input, cx| input.set_text("", cx));
                    }
                }
                _ => {}
            }),
            cx.subscribe_in(&replace_input, window, |this, _, event: &TextInputEvent, _, cx| match event {
                TextInputEvent::Changed(_) => {
                    this.confirm_replace_all = false;
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.replace_selected(cx),
                _ => {}
            }),
            cx.subscribe_in(&include_input, window, Self::filter_changed),
            cx.subscribe_in(&exclude_input, window, Self::filter_changed),
        ];
        let mut excludes = setting_excludes(cx);
        let settings_subscription = cx.try_global::<settings::SettingsStore>().is_some().then(|| {
            cx.observe_global::<settings::SettingsStore>(move |this: &mut Self, cx| {
                let next = setting_excludes(cx);
                if next != excludes {
                    excludes = next;
                    this.search(true, true, cx);
                }
            })
        });
        subscriptions.extend(settings_subscription);
        query_input.update(cx, |input, cx| input.focus(window, cx));

        let mut view = Self {
            roots,
            focus_handle: cx.focus_handle(),
            index: engine::index(cx),
            indexed: false,
            query_input,
            replace_input,
            include_input,
            exclude_input,
            options: SearchOptions::default(),
            details_visible: false,
            searched_query: String::new(),
            searched_options: SearchOptions::default(),
            files: Vec::new(),
            multibuffer: Multibuffer::new("search", true, |this: &mut Self| &mut this.multibuffer, window, cx),
            excerpts: Vec::new(),
            syntax: Vec::new(),
            match_lines: Vec::new(),
            sources: HashMap::new(),
            expanded: HashSet::new(),
            source_task: None,
            selected: None,
            phase: Phase::Idle,
            next_offset: 0,
            searched_files: 0,
            searchable_files: 0,
            regex_warning: None,
            notice: None,
            confirm_replace_all: false,
            replacing: false,
            search_task: None,
            replace_task: None,
            _subscriptions: subscriptions,
        };
        view.search(false, false, cx);
        view
    }

    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// Sets "Files to include", as Find in Folder does; the change searches again.
    pub fn set_include(&mut self, include: String, cx: &mut Context<Self>) {
        self.include_input.update(cx, |input, cx| input.set_text(include, cx));
    }

    fn filter_changed(&mut self, _: &Entity<TextInput>, event: &TextInputEvent, _: &mut Window, cx: &mut Context<Self>) {
        if matches!(event, TextInputEvent::Changed(_)) {
            self.search(true, true, cx);
        }
    }

    fn query(&self, cx: &App) -> String {
        self.query_input.read(cx).text().to_string()
    }

    fn match_count(&self) -> usize {
        self.files.iter().map(FileMatches::match_count).sum()
    }

    fn has_more(&self) -> bool {
        self.phase == Phase::Done && self.next_offset != 0
    }

    fn set_option(&mut self, update: impl FnOnce(&mut SearchOptions), cx: &mut Context<Self>) {
        update(&mut self.options);
        self.search(false, true, cx);
    }

    /// Starts the search over from the first file. `keep_selection` holds the selected row, as
    /// after a replacement, so the next match lands under it.
    fn search(&mut self, debounce: bool, keep_selection: bool, cx: &mut Context<Self>) {
        self.confirm_replace_all = false;
        if !keep_selection {
            self.selected = None;
            self.multibuffer.list().scroll_to(ListOffset::default());
        }
        self.sources.clear();
        // An excerpt load still running would put back the text from before (a replace).
        self.source_task = None;
        let query = self.query(cx);
        self.regex_warning = query::regex_error(&query, self.options);
        if query.is_empty() || self.roots.is_empty() {
            self.search_task = None;
            self.files.clear();
            self.searched_query.clear();
            self.next_offset = 0;
            self.phase = Phase::Idle;
            self.rebuild_rows(cx);
            cx.notify();
            return;
        }
        self.run(query, 0, debounce, cx);
    }

    fn load_more(&mut self, cx: &mut Context<Self>) {
        if self.has_more() {
            self.run(self.searched_query.clone(), self.next_offset, false, cx);
        }
    }

    fn run(&mut self, query: String, offset: usize, debounce: bool, cx: &mut Context<Self>) {
        let index = self.index.clone();
        let roots = Arc::new(self.roots.clone());
        let options = self.options;
        let pattern = Arc::new(query::grep_pattern(&query, options));
        let exclude = with_setting_excludes(self.exclude_input.read(cx).text(), cx);
        let filter = Arc::new(PathFilter::new(self.include_input.read(cx).text(), &exclude));
        let fresh = offset == 0;
        let limit = if fresh { MATCH_LIMIT } else { self.match_count() + MATCH_LIMIT };
        self.phase = if self.indexed { Phase::Searching } else { Phase::Indexing };
        cx.notify();
        self.search_task = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(DEBOUNCE).await;
            }
            let prepared = {
                let (index, roots) = (index.clone(), roots.clone());
                cx.background_spawn(async move { engine::prepare(&index, &roots) }).await
            };
            let indexed = this.update(cx, |this, cx| {
                match &prepared {
                    Ok(()) => {
                        this.indexed = true;
                        this.phase = Phase::Searching;
                    }
                    Err(error) => this.phase = Phase::Failed(error.to_string()),
                }
                cx.notify();
                prepared.is_ok()
            });
            if !matches!(indexed, Ok(true)) {
                return;
            }
            let mut offset = offset;
            let mut first = fresh;
            loop {
                let page = {
                    let (index, roots, pattern, filter) = (index.clone(), roots.clone(), pattern.clone(), filter.clone());
                    cx.background_spawn(async move { engine::grep_page(&index, &roots, &pattern, &filter, offset) }).await
                };
                let next = this.update(cx, |this, cx| {
                    let next = match page {
                        Ok(page) => {
                            if first {
                                this.files.clear();
                                this.searched_query = query.clone();
                                this.searched_options = options;
                                this.searched_files = 0;
                            }
                            this.searched_files += page.searched_files;
                            this.searchable_files = page.searchable_files;
                            engine::merge(&mut this.files, page.files);
                            this.next_offset = page.next_offset;
                            if let Some(error) = page.regex_error {
                                this.regex_warning = Some(error);
                            }
                            let done = page.next_offset == 0 || this.match_count() >= limit;
                            this.phase = if done { Phase::Done } else { Phase::Searching };
                            (!done).then_some(page.next_offset)
                        }
                        Err(error) => {
                            this.phase = Phase::Failed(error.to_string());
                            None
                        }
                    };
                    this.rebuild_rows(cx);
                    cx.notify();
                    next
                });
                first = false;
                match next {
                    Ok(Some(next)) => offset = next,
                    _ => break,
                }
            }
        }));
    }

    /// The excerpts and multibuffer sections of the results, and reads the files' lines for
    /// context in the background.
    fn rebuild_rows(&mut self, cx: &mut Context<Self>) {
        self.excerpts = self
            .files
            .iter()
            .map(|file| {
                let source = self.sources.get(&file.path).cloned().flatten();
                let context = if self.expanded.contains(&file.path) { EXPANDED_CONTEXT_LINES } else { CONTEXT_LINES };
                excerpt::build(file, source.as_ref().map(|lines| lines.as_slice()), context)
            })
            .collect();
        self.match_lines = self.files.iter().zip(&self.excerpts).map(|(file, lines)| excerpt::match_lines(lines, file.matches.len())).collect();
        self.syntax = self.files.iter().zip(&self.excerpts).map(|(file, lines)| excerpt_syntax(&file.path, lines)).collect();
        let sections = self.files.iter().enumerate().map(|(index, file)| self.section(index, file)).collect();
        let has_more = self.has_more();
        self.multibuffer.set_sections(sections, has_more);
        if let Some(Row::Match(file, found)) = self.selected
            && self.files.get(file).is_none_or(|file| found >= file.matches.len())
        {
            self.selected = None;
        }
        self.load_sources(cx);
    }

    fn section(&self, index: usize, file: &FileMatches) -> Section {
        let count = file.match_count();
        let shown = match self.selected {
            Some(Row::Match(selected, found)) if selected == index => file.matches.get(found),
            _ => file.matches.first(),
        };
        let mut trailing = Vec::new();
        if let Some(found) = shown {
            trailing.push((SharedString::from(format!(":{}", found.line)), Tone::Subtle));
        }
        trailing.push((format!("{count} {}", if count == 1 { "match" } else { "matches" }).into(), Tone::Subtle));
        Section {
            key: file.path.to_string_lossy().into_owned().into(),
            path: file.relative.clone().into(),
            icon_path: None,
            tone: Tone::Neutral,
            metadata: vec![(count.to_string().into(), Tone::Subtle)],
            trailing,
            rows: self.excerpts.get(index).map_or(0, Vec::len),
        }
    }

    fn load_sources(&mut self, cx: &mut Context<Self>) {
        if self.source_task.is_some() {
            return;
        }
        let missing: Vec<PathBuf> = self.files.iter().map(|file| file.path.clone()).filter(|path| !self.sources.contains_key(path)).collect();
        if missing.is_empty() {
            return;
        }
        let read = cx.background_spawn(async move { missing.into_iter().map(|path| { let lines = read_lines(&path); (path, lines) }).collect::<Vec<_>>() });
        self.source_task = Some(cx.spawn(async move |this, cx| {
            let read = read.await;
            this.update(cx, |this, cx| {
                this.source_task = None;
                this.sources.extend(read);
                this.rebuild_rows(cx);
                cx.notify();
            })
            .ok();
        }));
    }

    fn toggle_context(&mut self, file: usize, cx: &mut Context<Self>) {
        let Some(path) = self.files.get(file).map(|file| file.path.clone()) else { return };
        if !self.expanded.remove(&path) {
            self.expanded.insert(path);
        }
        self.rebuild_rows(cx);
        cx.notify();
    }

    /// The matches in order, skipping collapsed files: what the arrow keys step through.
    fn match_rows(&self) -> Vec<Row> {
        self.files
            .iter()
            .enumerate()
            .filter(|(index, _)| !self.multibuffer.is_collapsed(*index))
            .flat_map(|(index, file)| (0..file.matches.len()).map(move |found| Row::Match(index, found)))
            .collect()
    }

    fn move_selection(&mut self, delta: isize, cx: &mut Context<Self>) {
        let rows = self.match_rows();
        let Some(last) = rows.len().checked_sub(1) else { return };
        let next = match self.selected.and_then(|selected| rows.iter().position(|row| *row == selected)) {
            None if delta > 0 => 0,
            None => last,
            // Up from the first match goes to the last, and down from the last to the first.
            Some(index) => (index as isize + delta).rem_euclid(rows.len() as isize) as usize,
        };
        self.select(rows[next], cx);
    }

    fn select(&mut self, row: Row, cx: &mut Context<Self>) {
        self.selected = Some(row);
        let Row::Match(file, found) = row;
        if let Some(&line) = self.match_lines.get(file).and_then(|lines| lines.get(found)) {
            self.multibuffer.reveal_row(file, line);
        }
        let sections = self.files.iter().enumerate().map(|(index, file)| self.section(index, file)).collect();
        let has_more = self.has_more();
        self.multibuffer.set_sections(sections, has_more);
        cx.notify();
    }

    /// The selected match, or the first one.
    fn target_match(&self) -> Option<(usize, usize)> {
        match self.selected {
            Some(Row::Match(file, line)) => Some((file, line)),
            _ => self.files.first().map(|_| (0, 0)),
        }
    }

    fn open_selected(&mut self, cx: &mut Context<Self>) {
        match self.selected {
            Some(row) => self.activate(row, cx),
            None => {
                if let Some((file, line)) = self.target_match() {
                    self.activate(Row::Match(file, line), cx);
                }
            }
        }
    }

    fn activate(&mut self, row: Row, cx: &mut Context<Self>) {
        let Row::Match(file_index, match_index) = row;
        let Some(file) = self.files.get(file_index) else { return };
        let Some(found) = file.matches.get(match_index) else { return };
        // In UTF-16 units, as the editor's go-to reads columns (an emoji counts two).
        let column = found.text.get(..found.column).map(|before| before.encode_utf16().count() as u32 + 1);
        cx.emit(SearchEvent::OpenFile { path: file.path.clone(), line: Some(found.line), column });
    }

    fn set_notice(&mut self, message: impl Into<SharedString>, error: bool) {
        self.notice = Some(Notice { message: message.into(), error });
    }

    fn can_replace(&self) -> bool {
        !self.files.is_empty() && !self.replacing && self.regex_warning.is_none() && !matches!(self.phase, Phase::Indexing | Phase::Searching)
    }

    fn replace_selected(&mut self, cx: &mut Context<Self>) {
        if !self.can_replace() {
            return;
        }
        let Some((file_index, match_index)) = self.target_match() else { return };
        let Some(file) = self.files.get(file_index) else { return };
        let Some(found) = file.matches.get(match_index) else { return };
        let regex = match query::replacement_regex(&self.searched_query, self.searched_options) {
            Ok(regex) => regex,
            Err(error) => {
                self.set_notice(error.to_string(), true);
                cx.notify();
                return;
            }
        };
        let path = file.path.clone();
        let (line, column) = (found.line, found.column);
        let replacement = self.replace_input.read(cx).text().to_string();
        let expand = self.searched_options.use_regex;
        let name = file_name(&path);
        self.selected = Some(Row::Match(file_index, match_index));
        // A file open in an editor takes the replacement as an unsaved, undoable edit there.
        if let Some(content) = workbench_api::buffer_text(&path, cx) {
            match replace::replace_one(&content, &regex, &replacement, expand, line, column) {
                Some(replaced) if workbench_api::write_buffer_text(&path, &replaced, cx) => {
                    self.set_notice(format!("Replaced 1 match in {name}"), false);
                }
                _ => self.set_notice(format!("{} changed since the search. Search again before replacing.", path.display()), true),
            }
            self.search(false, true, cx);
            return;
        }
        self.replacing = true;
        cx.notify();
        self.replace_task = Some(cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move {
                    replace::replace_in_file(&path, &regex, &replacement, expand, line, column)
                })
                .await;
            this.update(cx, |this, cx| {
                this.replacing = false;
                match result {
                    Ok(()) => this.set_notice(format!("Replaced 1 match in {name}"), false),
                    Err(error) => this.set_notice(error.to_string(), true),
                }
                this.search(false, true, cx);
            })
            .ok();
        }));
    }

    fn request_replace_all(&mut self, cx: &mut Context<Self>) {
        if self.can_replace() && !self.has_more() {
            self.confirm_replace_all = true;
            cx.notify();
        }
    }

    fn replace_all(&mut self, cx: &mut Context<Self>) {
        self.confirm_replace_all = false;
        // Only the loaded results would be replaced (`Load all search results before replacing all`).
        if !self.can_replace() || self.has_more() {
            return;
        }
        let regex = match query::replacement_regex(&self.searched_query, self.searched_options) {
            Ok(regex) => regex,
            Err(error) => {
                self.set_notice(error.to_string(), true);
                cx.notify();
                return;
            }
        };
        let replacement = self.replace_input.read(cx).text().to_string();
        let expand = self.searched_options.use_regex;
        // Files open in an editor are replaced there (unsaved, undoable), the rest on disk.
        let (mut opened_replacements, mut opened_files) = (0, 0);
        let mut paths: Vec<PathBuf> = Vec::new();
        for path in self.files.iter().map(|file| file.path.clone()) {
            match workbench_api::buffer_text(&path, cx) {
                Some(content) => {
                    let (replaced, count) = replace::replace_all(&content, &regex, &replacement, expand);
                    if count > 0 && workbench_api::write_buffer_text(&path, &replaced, cx) {
                        opened_replacements += count;
                        opened_files += 1;
                    }
                }
                None => paths.push(path),
            }
        }
        self.replacing = true;
        cx.notify();
        self.replace_task = Some(cx.spawn(async move |this, cx| {
            let report = cx
                .background_spawn(async move { replace::replace_in_files(&paths, &regex, &replacement, expand) })
                .await;
            let report = replace::ReplaceReport { replacements: report.replacements + opened_replacements, files: report.files + opened_files, error: report.error };
            this.update(cx, |this, cx| {
                this.replacing = false;
                let done = query::summary(report.replacements, report.files, false).replacen("result", "match", 1);
                match report.error {
                    Some(error) if report.files > 0 => this.set_notice(format!("{error}. Replaced {done} before stopping."), true),
                    Some(error) => this.set_notice(error, true),
                    None => this.set_notice(format!("Replaced {done}"), false),
                }
                this.search(false, false, cx);
            })
            .ok();
        }));
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        if keystroke.modifiers.modified() {
            return;
        }
        let in_list = self.focus_handle.is_focused(window);
        let in_query = self.query_input.focus_handle(cx).is_focused(window);
        match keystroke.key.as_str() {
            "down" | "up" if in_list || in_query => {
                self.move_selection(if keystroke.key == "down" { 1 } else { -1 }, cx);
                cx.stop_propagation();
            }
            "enter" if in_list => {
                self.open_selected(cx);
                cx.stop_propagation();
            }
            "escape" if in_list => {
                self.query_input.update(cx, |input, cx| input.focus(window, cx));
                cx.stop_propagation();
            }
            _ => {}
        }
    }

    fn status(&self) -> Option<(SharedString, bool)> {
        if let Some(warning) = &self.regex_warning {
            return Some((format!("Invalid regular expression: {warning}").into(), true));
        }
        match &self.phase {
            Phase::Idle => None,
            Phase::Indexing => Some(("Indexing…".into(), false)),
            Phase::Searching if self.searchable_files > 0 => Some((
                format!("Searching… {} of {} files", self.searched_files.min(self.searchable_files), self.searchable_files).into(),
                false,
            )),
            Phase::Searching => Some(("Searching…".into(), false)),
            Phase::Done => Some((query::summary(self.match_count(), self.files.len(), self.has_more()).into(), false)),
            Phase::Failed(error) => Some((error.clone().into(), true)),
        }
    }

    fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let files_toggle = self.multibuffer.render_toggle(false, cx);
        let colors = &cx.theme().colors;
        let has_query = !self.query_input.read(cx).text().is_empty();
        let toggle = |id: &'static str, icon: IconName, label: &'static str, active: bool| {
            Button::icon(id, icon).size(ButtonSize::Small).active(active).tooltip(label)
        };
        let options = self.options;
        div()
            .flex()
            .flex_none()
            .items_center()
            .h(metrics::content_header())
            .px(metrics::chrome_padding_inline())
            .gap(metrics::chrome_gap())
            .child(
                Button::icon("search-details", if self.details_visible { IconName::ChevronDown } else { IconName::ChevronRight })
                    .size(ButtonSize::Small)
                    .tooltip(if self.details_visible { "Hide replace and filters" } else { "Show replace and filters" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.details_visible = !this.details_visible;
                        cx.notify();
                    })),
            )
            .child(Icon::new(IconName::Search).size(IconSize::Small).color(colors.subtle_foreground))
            .child(div().flex_1().min_w_0().child(self.query_input.clone()))
            .when(has_query, |this| {
                this.child(Button::icon("search-clear", IconName::X).size(ButtonSize::Small).tooltip("Clear search").on_click(
                    cx.listener(|this, _, window, cx| {
                        this.query_input.update(cx, |input, cx| {
                            input.set_text("", cx);
                            input.focus(window, cx);
                        });
                    }),
                ))
            })
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(metrics::chrome_gap_tight())
                    .child(toggle("search-case", IconName::CaseSensitive, "Match case", options.case_sensitive).on_click(
                        cx.listener(|this, _, _, cx| this.set_option(|options| options.case_sensitive ^= true, cx)),
                    ))
                    .child(toggle("search-word", IconName::Text, "Match whole word", options.whole_word).on_click(
                        cx.listener(|this, _, _, cx| this.set_option(|options| options.whole_word ^= true, cx)),
                    ))
                    .child(toggle("search-regex", IconName::BracketsCurly, "Use regular expression", options.use_regex).on_click(
                        cx.listener(|this, _, _, cx| this.set_option(|options| options.use_regex ^= true, cx)),
                    )),
            )
            .children(self.status().map(|(status, warning)| {
                div()
                    .flex_none()
                    .max_w(px(280.))
                    .truncate()
                    .px(px(4.))
                    .text_size(typography::text_chrome())
                    .text_color(if warning { colors.warning } else { colors.subtle_foreground })
                    .child(status)
            }))
            .child(files_toggle)
    }

    fn render_details(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let can_replace = self.can_replace();
        div()
            .flex()
            .flex_col()
            .flex_none()
            .gap(px(6.))
            .px(px(8.))
            .pb(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(div().flex_1().min_w_0().child(self.replace_input.clone()))
                    .child(
                        Button::new("search-replace", "Replace")
                            .size(ButtonSize::Small)
                            .disabled(!can_replace)
                            .tooltip("Replace the selected match")
                            .on_click(cx.listener(|this, _, _, cx| this.replace_selected(cx))),
                    )
                    .child(
                        Button::new("search-replace-all", "Replace All")
                            .size(ButtonSize::Small)
                            .disabled(!can_replace || self.has_more())
                            .tooltip(if self.has_more() { "Load all search results before replacing all" } else { "Replace every match in the results" })
                            .on_click(cx.listener(|this, _, _, cx| this.request_replace_all(cx))),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap(px(6.))
                    .child(div().flex_1().min_w_0().child(self.include_input.clone()))
                    .child(div().flex_1().min_w_0().child(self.exclude_input.clone())),
            )
    }

    /// The strip above the results: the Replace All confirmation, or what the last replacement did.
    fn render_banner(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let colors = &cx.theme().colors;
        let banner = |background| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(8.))
                .min_h(px(32.))
                .px(px(12.))
                .py(px(4.))
                .bg(background)
                .text_size(typography::text_sm())
        };
        if self.confirm_replace_all {
            let matches = self.match_count();
            let replacement = self.replace_input.read(cx).text();
            let with = if replacement.is_empty() { "nothing".to_string() } else { format!("“{replacement}”") };
            let partial = if self.next_offset != 0 { " (only the loaded results)" } else { "" };
            let message = format!(
                "Replace {matches} {} in {} {} with {with}{partial}?",
                if matches == 1 { "match" } else { "matches" },
                self.files.len(),
                if self.files.len() == 1 { "file" } else { "files" },
            );
            return Some(
                banner(colors.warning_soft)
                    .child(div().flex_1().min_w_0().text_color(colors.foreground).child(message))
                    .child(
                        Button::new("search-replace-cancel", "Cancel")
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Ghost)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.confirm_replace_all = false;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("search-replace-confirm", "Replace All")
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Destructive)
                            .on_click(cx.listener(|this, _, _, cx| this.replace_all(cx))),
                    )
                    .into_any_element(),
            );
        }
        let notice = self.notice.as_ref()?;
        Some(
            banner(if notice.error { colors.destructive_soft } else { colors.success_soft })
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_color(if notice.error { colors.destructive } else { colors.foreground })
                        .child(notice.message.clone()),
                )
                .child(Button::icon("search-notice-dismiss", IconName::X).size(ButtonSize::XSmall).tooltip("Dismiss").on_click(
                    cx.listener(|this, _, _, cx| {
                        this.notice = None;
                        cx.notify();
                    }),
                ))
                .into_any_element(),
        )
    }

    fn render_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let centred = |state: EmptyState| div().flex().flex_1().items_center().justify_center().child(state).into_any_element();
        // A quiet line near the top, as the original's `EmptyState layout="sidebar"`.
        let top = |state: EmptyState| div().flex().flex_1().justify_center().py(px(24.)).child(state).into_any_element();
        if self.roots.is_empty() {
            return centred(EmptyState::new("No project open").icon(IconName::Folder).message("Open a folder to search its files."));
        }
        if self.files.is_empty() {
            return match &self.phase {
                Phase::Idle => top(EmptyState::new("").icon(IconName::Search).message("Enter a query to search files and lines.")),
                Phase::Indexing => centred(EmptyState::new("Indexing the project").icon(IconName::Search).message("Results appear once the files are indexed.")),
                Phase::Searching => top(EmptyState::new("").message("Searching…")),
                Phase::Failed(error) => centred(
                    EmptyState::new("Search failed").icon(IconName::WarningCircle).message(error.clone()).action(
                        Button::new("search-retry", "Try again").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.search(false, false, cx))),
                    ),
                ),
                Phase::Done => {
                    let filtered = !self.include_input.read(cx).text().is_empty() || !self.exclude_input.read(cx).text().is_empty();
                    let filters = if filtered { " with the current file filters" } else { "" };
                    top(EmptyState::new("").message(format!("No results for \"{}\"{filters}.", self.searched_query)))
                }
            };
        }
        let state = self.multibuffer.list().clone();
        let body = ui::with_scrollbar(
            list(state.clone(), cx.processor(|this, index: usize, window, cx| this.render_entry(index, window, cx))).size_full(),
            ui::Scrollbar::list("search-results-scrollbar", &state),
        )
        .size_full()
        .into_any_element();
        let sticky = self.multibuffer.sticky_section().map(|file| self.render_file_header(file, cx));
        self.multibuffer.render(None, body, sticky, None, cx)
    }

    fn render_entry(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let focused = self.focus_handle.is_focused(window) || self.query_input.focus_handle(cx).is_focused(window);
        match self.multibuffer.entry(index) {
            Some(Entry::Header(file)) => self.render_file_header(file, cx),
            Some(Entry::Row(file, line)) => self.render_line(file, line, focused, cx),
            Some(Entry::Footer) => self.render_load_more(cx),
            None => div().into_any_element(),
        }
    }

    /// A file's header: its name opens the selected (or first) match; the button widens or
    /// narrows the context.
    fn render_file_header(&self, file_index: usize, cx: &mut Context<Self>) -> AnyElement {
        let Some(file) = self.files.get(file_index) else { return div().into_any_element() };
        let target = match self.selected {
            Some(Row::Match(selected, found)) if selected == file_index => found,
            _ => 0,
        };
        let open: Option<OpenHandler<Self>> = (!file.matches.is_empty()).then(|| {
            Rc::new(move |this: &mut Self, _: &mut Window, cx: &mut Context<Self>| this.activate(Row::Match(file_index, target), cx)) as OpenHandler<Self>
        });
        let expanded = self.expanded.contains(&file.path);
        let loading = self.source_task.is_some() && !self.sources.contains_key(&file.path);
        let toggle = Button::icon(("search-context", file_index), if expanded { IconName::Minus } else { IconName::Plus })
            .size(ButtonSize::XSmall)
            .disabled(loading)
            .tooltip(if loading { "Loading context" } else if expanded { "Collapse context" } else { "Expand context" })
            .on_click(cx.listener(move |this, _, _, cx| {
                cx.stop_propagation();
                this.toggle_context(file_index, cx)
            }))
            .into_any_element();
        self.multibuffer.render_header(file_index, vec![toggle], open, cx)
    }

    fn render_line(&self, file_index: usize, line_index: usize, focused: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(line) = self.excerpts.get(file_index).and_then(|lines| lines.get(line_index)) else { return div().into_any_element() };
        let base = div()
            .flex()
            .items_center()
            .h(line_height())
            .w_full()
            .min_w_0()
            .font_family(typography::MONO_FONT)
            .text_size(typography::text_sm())
            .whitespace_nowrap();
        match line {
            ExcerptLine::Gap => base
                .child(div().flex_none().w(px(56.)).pr(px(12.)).text_right().text_color(colors.subtle_foreground).child("..."))
                .into_any_element(),
            ExcerptLine::Line { number, text, ranges, found } => {
                let row = found.map(|found| Row::Match(file_index, found));
                let selected = row.is_some() && self.selected == row;
                let highlight = HighlightStyle { color: Some(colors.foreground), background_color: Some(colors.warning.opacity(0.28)), ..Default::default() };
                let spans = self.syntax.get(file_index).and_then(|lines| lines.get(line_index)).map(Vec::as_slice).unwrap_or_default();
                let theme = cx.theme().clone();
                let syntax: Vec<(Range<usize>, gpui::Hsla)> = spans.iter().map(|(range, kind)| (range.clone(), kind.color(&theme))).collect();
                let (text, highlights) = styled_line(text, ranges, &syntax, highlight);
                let text = StyledText::new(if text.is_empty() { " ".to_string() } else { text }).with_highlights(highlights);
                let number = *number;
                base.id(SharedString::from(format!("search-line-{file_index}-{line_index}")))
                    .map(|this| ui::sidebar_row(this, selected, focused, cx))
                    .child(
                        div()
                            .flex_none()
                            .w(px(56.))
                            .pr(px(12.))
                            .text_right()
                            .text_color(if found.is_some() { colors.muted_foreground } else { colors.subtle_foreground })
                            .child(number.to_string()),
                    )
                    .child(div().flex_1().min_w_0().overflow_hidden().text_color(if found.is_some() { colors.foreground } else { colors.muted_foreground }).child(text))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        window.focus(&this.focus_handle, cx);
                        match row {
                            Some(row) => {
                                this.select(row, cx);
                                this.activate(row, cx);
                            }
                            None => {
                                if let Some(file) = this.files.get(file_index) {
                                    cx.emit(SearchEvent::OpenFile { path: file.path.clone(), line: Some(number), column: None });
                                }
                            }
                        }
                    }))
                    .into_any_element()
            }
        }
    }

    fn render_load_more(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let (hover, hover_text) = (colors.accent, colors.foreground);
        div()
            .id("search-load-more")
            .flex()
            .items_center()
            .justify_center()
            .h(row_height())
            .my(px(8.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .text_color(colors.subtle_foreground)
            .hover(move |style| style.bg(hover).text_color(hover_text))
            .child(format!("Showing {} results. Load more", self.match_count()))
            .on_click(cx.listener(|this, _, _, cx| this.load_more(cx)))
            .into_any_element()
    }
}

/// Syntax spans of each line of an excerpt, each run of consecutive lines highlighted together.
fn excerpt_syntax(path: &Path, lines: &[ExcerptLine]) -> Vec<Vec<(Range<usize>, editor::SyntaxKind)>> {
    let mut out = vec![Vec::new(); lines.len()];
    let mut start = 0;
    while start < lines.len() {
        let end = start + lines[start..].iter().take_while(|line| matches!(line, ExcerptLine::Line { .. })).count();
        if end > start {
            let mut text = String::new();
            let mut offsets = Vec::with_capacity(end - start);
            for line in &lines[start..end] {
                if let ExcerptLine::Line { text: line, .. } = line {
                    offsets.push(text.len());
                    text.push_str(line);
                    text.push('\n');
                }
            }
            for (range, kind) in editor::highlight_snippet(path, &text) {
                let index = offsets.partition_point(|offset| *offset <= range.start).saturating_sub(1);
                let line_start = offsets[index];
                let line_end = offsets.get(index + 1).map_or(text.len(), |next| next - 1);
                let clipped = range.start.max(line_start)..range.end.min(line_end);
                if !clipped.is_empty() {
                    out[start + index].push((clipped.start - line_start..clipped.end - line_start, kind));
                }
            }
        }
        start = end + 1;
    }
    out
}

/// The drawn line with syntax colours and the match highlight laid over them, split where
/// either changes so no two highlights overlap.
fn styled_line(text: &str, matches: &[Range<usize>], syntax: &[(Range<usize>, gpui::Hsla)], highlight: HighlightStyle) -> (String, Vec<(Range<usize>, HighlightStyle)>) {
    let syntax_ranges: Vec<Range<usize>> = syntax.iter().map(|(range, _)| range.clone()).collect();
    let (shown, matches) = display_line(text, matches);
    let (_, mapped) = display_line_keep(text, &syntax_ranges);
    let colored: Vec<(Range<usize>, gpui::Hsla)> = mapped.into_iter().zip(syntax).map(|(range, (_, color))| (range, *color)).filter(|(range, _)| !range.is_empty()).collect();
    let mut cuts: Vec<usize> = colored.iter().flat_map(|(range, _)| [range.start, range.end]).chain(matches.iter().flat_map(|range| [range.start, range.end])).collect();
    cuts.sort_unstable();
    cuts.dedup();
    let mut out = Vec::new();
    for pair in cuts.windows(2) {
        let segment = pair[0]..pair[1];
        let color = colored.iter().find(|(range, _)| range.start <= segment.start && segment.end <= range.end).map(|(_, color)| *color);
        let found = matches.iter().any(|range| range.start <= segment.start && segment.end <= range.end);
        match (color, found) {
            (_, true) => out.push((segment, highlight)),
            (Some(color), false) => out.push((segment, HighlightStyle { color: Some(color), ..Default::default() })),
            (None, false) => {}
        }
    }
    (shown, out)
}

/// The drawn line and `ranges` moved along with it, empty ones kept so they stay in step.
fn display_line_keep(text: &str, ranges: &[Range<usize>]) -> (String, Vec<Range<usize>>) {
    let text = text.strip_suffix('\r').unwrap_or(text);
    let mut out = String::with_capacity(text.len());
    let mut map = Vec::with_capacity(text.len() + 1);
    for ch in text.chars() {
        for _ in 0..ch.len_utf8() {
            map.push(out.len());
        }
        if ch == '\t' { out.push_str("    ") } else { out.push(ch) }
    }
    map.push(out.len());
    let at = |offset: usize| map[offset.min(map.len() - 1)];
    (out, ranges.iter().map(|range| at(range.start)..at(range.end)).collect())
}

/// A line as drawn: tabs as four spaces and no carriage return, with byte ranges moved along.
fn display_line(text: &str, ranges: &[Range<usize>]) -> (String, Vec<Range<usize>>) {
    let (out, ranges) = display_line_keep(text, ranges);
    (out, ranges.into_iter().filter(|range| !range.is_empty()).collect())
}

#[cfg(not(target_family = "wasm"))]
fn read_lines(path: &Path) -> Option<Arc<Vec<String>>> {
    if remote::is_remote(path) {
        let text = remote::shell_for(path)?.read(path)?;
        return (text.len() as u64 <= MAX_SOURCE_BYTES).then(|| Arc::new(text.lines().map(str::to_string).collect()));
    }
    if std::fs::metadata(path).ok()?.len() > MAX_SOURCE_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(Arc::new(text.lines().map(str::to_string).collect()))
}

#[cfg(target_family = "wasm")]
fn read_lines(_: &Path) -> Option<Arc<Vec<String>>> {
    None
}

/// `searchExcludePatterns`: globs every search leaves out, besides the field's.
fn setting_excludes(cx: &App) -> Vec<String> {
    cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).search_exclude_patterns.clone()).unwrap_or_default()
}

fn with_setting_excludes(field: &str, cx: &App) -> String {
    join_excludes(field, &setting_excludes(cx))
}

fn join_excludes(field: &str, patterns: &[String]) -> String {
    std::iter::once(field.trim()).chain(patterns.iter().map(|pattern| pattern.trim())).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(",")
}

#[cfg(test)]
mod setting_tests {
    use super::*;

    #[test]
    fn setting_excludes_join_the_field() {
        assert_eq!(join_excludes(" target/** ", &["*.lock".into(), " ".into()]), "target/**,*.lock");
        assert_eq!(join_excludes("", &[]), "");
        let filter = PathFilter::new("", &join_excludes("", &["*.lock".into()]));
        assert!(!filter.matches("Cargo.lock"));
        assert!(filter.matches("src/main.rs"));
    }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

impl Render for SearchView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .id("search-view")
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            // Narrower than its results: the Files navigator then sits beside them instead of
            // the view growing past the tab and the navigator covering the results' right edge.
            .min_w_0()
            .overflow_hidden()
            .bg(colors.background)
            .on_key_down(cx.listener(Self::on_key_down))
            .child(self.render_toolbar(cx))
            .when(self.details_visible, |this| this.child(self.render_details(cx)))
            .child(div().flex_none().h(px(1.)).bg(colors.divider))
            .children(self.render_banner(cx))
            .child(
                div()
                    .id("search-results-area")
                    .track_focus(&self.focus_handle)
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .pt(px(4.))
                    .child(self.render_body(cx)),
            )
    }
}

#[cfg(test)]
mod styled_line_tests {
    use super::*;

    #[test]
    fn match_highlight_wins_over_syntax_colours() {
        let red = gpui::red();
        let found = HighlightStyle { background_color: Some(gpui::yellow()), ..Default::default() };
        let (text, highlights) = styled_line("\tlet x = 1;", &[5..6], &[(1..4, red)], found);
        assert_eq!(text, "    let x = 1;");
        assert_eq!(highlights.iter().map(|(range, style)| (range.clone(), style.background_color.is_some())).collect::<Vec<_>>(), vec![(4..7, false), (8..9, true)]);
    }

    #[test]
    fn excerpt_lines_get_their_own_spans() {
        let lines = vec![
            ExcerptLine::Line { number: 1, text: "fn main() {".into(), ranges: Vec::new(), found: None },
            ExcerptLine::Gap,
            ExcerptLine::Line { number: 9, text: "let s = \"x\";".into(), ranges: Vec::new(), found: None },
        ];
        let spans = excerpt_syntax(Path::new("a.rs"), &lines);
        assert!(spans[0].iter().any(|(range, kind)| *range == (0..2) && *kind == editor::SyntaxKind::Keyword), "{:?}", spans[0]);
        assert!(spans[1].is_empty());
        assert!(spans[2].iter().any(|(range, kind)| *range == (8..11) && *kind == editor::SyntaxKind::String), "{:?}", spans[2]);
    }
}
