use std::{
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
    time::Duration,
};

#[cfg(not(target_family = "wasm"))]
use athas_fff_search::{FffGrepMatch, FffGrepOptions, FffSearch, FffSearchHit, GrepMode};
#[cfg(target_family = "wasm")]
pub use web_index::set_file_lister;
#[cfg(target_family = "wasm")]
use web_index::{FffSearch, FffSearchHit};
use gpui::{AnyElement, App, Context, Global, SharedString, Task, Window, div, prelude::*, px};
use lsp_client::{LspStore, WorkspaceSymbol, lsp::SymbolKind};
use theme::ActiveTheme;
use ui::{IconName, Kbd, typography};

use crate::{
    FuzzyMatch, Picker, PickerDelegate, PaletteRow, fuzzy_match,
    quick_open_sources::{GitHubRow, GitRow, QuickOpenGit, QuickOpenGitHub, badges, file_name, folder, git_rows, github_rows, substring_positions},
};

/// A session quick open can jump to.
#[derive(Clone, Debug)]
pub struct QuickOpenSession {
    pub id: String,
    pub title: String,
    pub project: Option<String>,
}

/// An installed agent a new chat can start with (`use-agents-section.tsx`).
#[derive(Clone, Debug)]
pub struct QuickOpenAgent {
    pub id: String,
    pub name: String,
    pub description: String,
    /// The agent of the session in front.
    pub current: bool,
}

/// An open tab quick open can switch to (`use-tabs-section.tsx`).
#[derive(Clone, Debug)]
pub struct QuickOpenTab {
    pub group: u64,
    pub index: usize,
    pub title: String,
    /// The folder of a file, or what kind of tab it is.
    pub description: String,
    pub icon: IconName,
    pub dirty: bool,
    pub pinned: bool,
    pub active: bool,
    /// The file a file tab shows.
    pub path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub enum QuickOpenItem {
    File(PathBuf),
    Session(String),
    /// A project symbol, with a 1-based line and column.
    Symbol { path: PathBuf, line: u32, column: u32 },
    /// A line of text in a file, 1-based.
    Text { path: PathBuf, line: u32, column: u32 },
    Tab { group: u64, index: usize },
    NewSession,
    /// A new chat with this agent.
    NewAgentSession(String),
    /// A changed file's diff, `path` relative to `repo`.
    GitChange { repo: PathBuf, path: String, staged: bool },
    /// Switch to a branch; nothing happens for the current one.
    Branch { repo: PathBuf, name: String, current: bool },
    Commit { repo: PathBuf, hash: String, message: String },
    PullRequest { number: i64, title: String },
    Issue { number: i64, title: String },
}

/// Loads a section's data the first time it is shown.
pub type GitLoader = Box<dyn FnOnce(&mut App) -> Task<Option<QuickOpenGit>>>;
pub type GitHubLoader = Box<dyn FnOnce(&mut App) -> Task<QuickOpenGitHub>>;
/// The active file's symbols (`textDocument/documentSymbol`), flattened.
pub type FileSymbolLoader = Box<dyn FnOnce(&mut App) -> Task<Vec<WorkspaceSymbol>>>;

enum Source<L, T> {
    Unavailable,
    Pending(L),
    Loading,
    Loaded(T),
}

impl<L, T> Source<L, T> {
    fn loaded(&self) -> Option<&T> {
        match self {
            Source::Loaded(value) => Some(value),
            _ => None,
        }
    }

    fn is_loading(&self) -> bool {
        matches!(self, Source::Pending(_) | Source::Loading)
    }
}

/// The sections along the top (`QUICK_OPEN_SECTIONS`), each with its own search.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Section {
    Files,
    Text,
    Symbols,
    Git,
    GitHub,
    Agents,
    Tabs,
}

impl Section {
    const ALL: [Section; 7] = [Section::Files, Section::Text, Section::Symbols, Section::Git, Section::GitHub, Section::Agents, Section::Tabs];

    fn label(self) -> &'static str {
        match self {
            Section::Files => "Files",
            Section::Text => "Text",
            Section::Symbols => "Symbols",
            Section::Git => "Git",
            Section::GitHub => "GitHub",
            Section::Agents => "Agents",
            Section::Tabs => "Tabs",
        }
    }

    fn placeholder(self) -> &'static str {
        match self {
            Section::Files => "Search files by name...",
            Section::Text => "Search text in files...",
            Section::Symbols => "Search symbols in this file and the project...",
            Section::Git => "Search changes, branches and commits...",
            Section::GitHub => "Search pull requests and issues...",
            Section::Agents => "Search agent chats, or start one...",
            Section::Tabs => "Switch to an open tab...",
        }
    }

    fn icon(self) -> IconName {
        match self {
            Section::Files => IconName::Files,
            Section::Text => IconName::TextAlignLeft,
            Section::Symbols => IconName::Code,
            Section::Git => IconName::GitBranch,
            Section::GitHub => IconName::GitPullRequest,
            Section::Agents => IconName::Sparkle,
            Section::Tabs => IconName::Stack,
        }
    }

    fn prefixes(self) -> &'static [&'static str] {
        match self {
            Section::Text => &["%"],
            Section::Symbols => &["@", "#"],
            _ => &[],
        }
    }
}

/// The section a typed prefix leads to, with the query after it (`matchQuickOpenPrefix`).
pub fn match_prefix(query: &str) -> Option<(Section, &str)> {
    Section::ALL.iter().find_map(|section| {
        section.prefixes().iter().find_map(|prefix| query.strip_prefix(prefix).map(|rest| (*section, rest.trim_start())))
    })
}

const TEXT_SEARCH_MIN_LENGTH: usize = 2;
#[cfg(not(target_family = "wasm"))]
const TEXT_SEARCH_MAX_MATCHES: usize = 200;
/// Lines are cut to start this many characters before the match, so it stays in view.
#[cfg(not(target_family = "wasm"))]
const EXCERPT_LEAD: usize = 24;

/// A line with a match, cut so the match shows (`toTextMatches`).
#[derive(Clone, Debug, PartialEq)]
pub struct TextMatch {
    pub path: PathBuf,
    pub line: u32,
    pub column: u32,
    pub excerpt: String,
}

#[cfg(not(target_family = "wasm"))]
fn text_match(found: &FffGrepMatch) -> TextMatch {
    let content = &found.line_content;
    let characters: Vec<char> = content.chars().collect();
    let indent = characters.iter().take_while(|character| character.is_whitespace()).count();
    let column = content.get(..found.column.min(content.len())).map_or(found.column, |prefix| prefix.chars().count());
    let start = indent.max(column.saturating_sub(EXCERPT_LEAD));
    let excerpt: String = characters[start.min(characters.len())..].iter().collect::<String>().trim_end().to_string();
    TextMatch {
        path: PathBuf::from(&found.file_path),
        line: found.line_number as u32,
        // The editor's go-to reads UTF-16 units (an emoji counts two).
        column: content.get(..found.column.min(content.len())).map_or(column, |prefix| prefix.encode_utf16().count()) as u32 + 1,
        excerpt: if start > indent { format!("…{excerpt}") } else { excerpt },
    }
}

/// The project file index, shared across quick opens so a second open is instant.
struct FileIndex(Arc<FffSearch>);

impl Global for FileIndex {}

/// Where the index keeps how often and how recently files were opened, once the app asks for it
/// (`fff-frecency.lmdb` in the app data folder); tests and snapshots search without it.
struct FrecencyStore(PathBuf);

impl Global for FrecencyStore {}

#[cfg(not(target_family = "wasm"))]
pub fn use_frecency_store(path: PathBuf, cx: &mut App) {
    cx.set_global(FrecencyStore(path));
}

#[cfg(not(target_family = "wasm"))]
pub fn frecency_store_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("fff-frecency.lmdb"))
}

fn file_index(cx: &mut App) -> Arc<FffSearch> {
    if let Some(index) = cx.try_global::<FileIndex>() {
        return index.0.clone();
    }
    let index = Arc::new(new_file_index(cx.try_global::<FrecencyStore>().map(|store| store.0.clone())));
    cx.set_global(FileIndex(index.clone()));
    index
}

#[cfg(not(target_family = "wasm"))]
fn new_file_index(frecency: Option<PathBuf>) -> FffSearch {
    frecency.and_then(|path| FffSearch::new(path).inspect_err(|error| log::warn!("fff frecency unavailable: {error:#}")).ok()).unwrap_or_else(|| FffSearch::without_frecency(false))
}

#[cfg(target_family = "wasm")]
fn new_file_index(_: Option<PathBuf>) -> FffSearch {
    FffSearch::without_frecency(false)
}

/// A file the project index matched (`search_file_index`).
#[derive(Clone, Debug, PartialEq)]
pub struct FileIndexHit {
    pub path: PathBuf,
    pub name: String,
    /// Relative to the root it was found under.
    pub relative_path: String,
}

/// Searches the shared quick open index at once, ranked by fff (fuzzy match and frecency), for a
/// menu that asks on every keystroke (Add context > Project files). Roots not indexed yet start
/// indexing and give what is ready; remote roots are left out. An empty query lists files.
pub fn search_file_index(roots: &[PathBuf], query: &str, limit: usize, cx: &mut App) -> Vec<FileIndexHit> {
    let index = file_index(cx);
    #[cfg(not(target_family = "wasm"))]
    let roots: Vec<&Path> = roots.iter().filter(|root| !crate::remote_files::is_remote_root(root)).map(PathBuf::as_path).collect();
    #[cfg(target_family = "wasm")]
    let roots: Vec<&Path> = roots.iter().map(PathBuf::as_path).collect();
    if roots.is_empty() || index.ensure_workspaces(roots.iter().copied()).is_err() {
        return Vec::new();
    }
    let hit = |path: String, name: String, relative_path: String| FileIndexHit { path: PathBuf::from(path), name, relative_path };
    if query.trim().is_empty() {
        return index
            .list_files(roots.iter().copied())
            .map(|files| files.into_iter().take(limit).map(|file| hit(file.path, file.name, file.relative_path)).collect())
            .unwrap_or_default();
    }
    index.search(roots.iter().copied(), query, limit).map(|hits| hits.into_iter().map(|found| hit(found.path, found.name, found.relative_path)).collect()).unwrap_or_default()
}

/// Brings the file index up to date with changes a watcher reported under `root`; the index
/// never watches on its own (`apply_changes` in `file_events.rs`).
pub fn index_files_changed(root: &Path, paths: &[PathBuf], rescan: bool, cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    if let Some(index) = cx.try_global::<FileIndex>().map(|index| index.0.clone()) {
        let (root, paths) = (root.to_path_buf(), paths.to_vec());
        cx.background_spawn(async move {
            let (changes, git_changed) = fff_changes(&paths);
            if let Err(error) = index.apply_changes(&root, &changes, rescan, git_changed) {
                log::warn!("Could not update the quick open index for {}: {error:#}", root.display());
            }
        })
        .detach();
    }
    #[cfg(target_family = "wasm")]
    let _ = (root, paths, rescan, cx);
}

/// Watcher paths as the index takes them, and whether any lies inside `.git`.
#[cfg(not(target_family = "wasm"))]
pub fn fff_changes(paths: &[PathBuf]) -> (Vec<athas_fff_search::FffFsChange>, bool) {
    let git_changed = paths.iter().any(|path| path.components().any(|part| part.as_os_str() == ".git"));
    let changes = paths
        .iter()
        .filter(|path| !path.components().any(|part| part.as_os_str() == ".git"))
        .map(|path| {
            let metadata = std::fs::symlink_metadata(path).ok();
            athas_fff_search::FffFsChange { path: path.clone(), removed: metadata.is_none(), is_dir: metadata.is_some_and(|metadata| metadata.is_dir()) }
        })
        .collect();
    (changes, git_changed)
}

/// Records an open in the index's frecency off the main thread, so files opened often rank
/// first (`fffTrackAccess`).
pub fn track_file_access(path: &Path, cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    if cx.has_global::<FrecencyStore>() && path.is_absolute() {
        let index = file_index(cx);
        let path = path.to_path_buf();
        cx.background_spawn(async move {
            if let Err(error) = index.track_access(&path) {
                log::warn!("fff track_access failed: {error:#}");
            }
        })
        .detach();
    }
    #[cfg(target_family = "wasm")]
    let _ = (path, cx);
}

/// Files of `roots` matching `query` from quick open's shared index, best first, as absolute
/// paths (`useFffSearch`); `None` without the app's index store, so tests and snapshots rank the
/// files they list instead.
pub fn search_project_files(roots: Vec<PathBuf>, query: String, limit: usize, cx: &mut App) -> Option<Task<Vec<PathBuf>>> {
    if !cx.has_global::<FrecencyStore>() || query.trim().is_empty() {
        return None;
    }
    let index = file_index(cx);
    Some(cx.background_spawn(async move {
        QuickOpenDelegate::search_files(&index, &roots, &query, &|| false).into_iter().take(limit).map(|hit| PathBuf::from(hit.path)).collect()
    }))
}

/// The recently opened files of the workspace with `roots`, highest frecency first; empty
/// without the app's index store, so tests never read the saved list.
pub fn recent_workspace_files(roots: &[PathBuf], cx: &mut App) -> Vec<PathBuf> {
    if !cx.has_global::<FrecencyStore>() {
        return Vec::new();
    }
    crate::recent_files::recent_files(cx).in_workspace(roots, crate::recent_files::now_ms())
}

enum Match {
    Session(usize, FuzzyMatch),
    File(FffSearchHit),
    Symbol(WorkspaceSymbol),
    FileSymbol(WorkspaceSymbol),
    Text(TextMatch),
    Tab(usize, FuzzyMatch),
    NewSession,
    NewAgent(usize, FuzzyMatch),
    Git(GitRow),
    GitHub(GitHubRow),
}

/// `useSymbolSearch`: with no query, by kind (classes first) then line; else by fuzzy score.
fn file_symbol_matches(symbols: &[WorkspaceSymbol], query: &str) -> Vec<WorkspaceSymbol> {
    if query.is_empty() {
        let order = |kind: SymbolKind| {
            [
                SymbolKind::CLASS,
                SymbolKind::INTERFACE,
                SymbolKind::STRUCT,
                SymbolKind::ENUM,
                SymbolKind::FUNCTION,
                SymbolKind::METHOD,
                SymbolKind::CONSTRUCTOR,
                SymbolKind::PROPERTY,
                SymbolKind::FIELD,
                SymbolKind::VARIABLE,
                SymbolKind::CONSTANT,
            ]
            .iter()
            .position(|known| *known == kind)
            .unwrap_or(99)
        };
        let mut sorted = symbols.to_vec();
        sorted.sort_by_key(|symbol| (order(symbol.kind), symbol.line));
        return sorted;
    }
    let mut scored: Vec<(i64, &WorkspaceSymbol)> = symbols.iter().filter_map(|symbol| Some((fuzzy_match(query, &symbol.name)?.score, symbol))).collect();
    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    scored.into_iter().map(|(_, symbol)| symbol.clone()).collect()
}

fn symbol_icon(kind: SymbolKind) -> IconName {
    match kind {
        SymbolKind::FUNCTION | SymbolKind::METHOD | SymbolKind::CONSTRUCTOR => IconName::Code,
        SymbolKind::CLASS => IconName::Grid,
        SymbolKind::INTERFACE => IconName::PuzzlePiece,
        SymbolKind::STRUCT => IconName::Cube,
        SymbolKind::ENUM => IconName::Stack,
        SymbolKind::ENUM_MEMBER => IconName::Hash,
        SymbolKind::VARIABLE | SymbolKind::CONSTANT => IconName::Function,
        SymbolKind::PROPERTY | SymbolKind::FIELD => IconName::BracketsCurly,
        SymbolKind::TYPE_PARAMETER => IconName::Text,
        _ => IconName::Code,
    }
}

/// Quick open (`features/quick-open`): files, text, symbols, agent chats and open tabs, one
/// section at a time; Tab moves between sections and `%`, `@` or `#` jump to one.
pub struct QuickOpenDelegate {
    roots: Vec<PathBuf>,
    sessions: Vec<QuickOpenSession>,
    agents: Vec<QuickOpenAgent>,
    tabs: Vec<QuickOpenTab>,
    section: Section,
    query: String,
    index: Arc<FffSearch>,
    matches: Vec<Match>,
    selected: usize,
    searching: Option<Task<()>>,
    /// Enter arrived before the search answered; open its first result when it does.
    confirm_pending: bool,
    /// Bumped on every query, so a search waiting for the first scan can give up once stale.
    generation: Arc<std::sync::atomic::AtomicU64>,
    /// The symbol search typed after `@` or `#`, while one is.
    symbols: Option<String>,
    git: Source<GitLoader, Option<QuickOpenGit>>,
    github: Source<GitHubLoader, QuickOpenGitHub>,
    file_symbols: Source<FileSymbolLoader, Vec<WorkspaceSymbol>>,
    /// Project symbols of the last search, kept apart so the file's symbols can be refiltered.
    project_symbols: Vec<WorkspaceSymbol>,
    loads: Vec<Task<()>>,
    /// Files recently opened from here, of this workspace, highest frecency first.
    recent: Vec<PathBuf>,
    on_open: Rc<dyn Fn(QuickOpenItem, &mut Window, &mut App)>,
}

const FILE_LIMIT: usize = 60;

/// Waits up to 3 s for the first scan, in short steps so a newer query frees this thread at
/// once. False when the query went stale meanwhile.
#[cfg(not(target_family = "wasm"))]
fn wait_for_scan(index: &FffSearch, roots: &[&Path], stale: &dyn Fn() -> bool) -> bool {
    for _ in 0..30 {
        if stale() {
            return false;
        }
        if index.wait_for_scan(roots.iter().copied(), Duration::from_millis(100)).is_ok() {
            return true;
        }
    }
    !stale()
}

#[cfg(target_family = "wasm")]
fn wait_for_scan(index: &FffSearch, roots: &[&Path], stale: &dyn Fn() -> bool) -> bool {
    index.wait_for_scan(roots.iter().copied(), Duration::from_secs(3)).ok();
    !stale()
}

fn path_hit(path: &Path, roots: &[PathBuf]) -> FffSearchHit {
    FffSearchHit {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map_or_else(|| path.to_string_lossy().into_owned(), |name| name.to_string_lossy().into_owned()),
        relative_path: roots
            .iter()
            .find_map(|root| path.strip_prefix(root).ok())
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned(),
        score: 0,
    }
}

/// `categorizeFileSearchHits`: files open in other tabs first, then recently opened ones, then the
/// rest, the active file left out; with no query the open files and up to ten recent ones lead
/// even when the index has not listed them.
fn rank_file_hits(hits: Vec<FffSearchHit>, open: &[PathBuf], recent: &[PathBuf], active: Option<&Path>, roots: &[PathBuf], query: &str) -> Vec<FffSearchHit> {
    let is_open = |path: &Path| open.iter().any(|open| open == path);
    let recent_index = |path: &Path| recent.iter().position(|recent| recent == path);
    let mut hits: Vec<FffSearchHit> = hits.into_iter().filter(|hit| Some(Path::new(&hit.path)) != active).collect();
    if query.trim().is_empty() {
        let recent: Vec<&PathBuf> = recent
            .iter()
            .filter(|path| Some(path.as_path()) != active && !is_open(path))
            .take(crate::recent_files::MAX_RECENT_FILES_NO_QUERY.min(FILE_LIMIT.saturating_sub(open.len())))
            .collect();
        hits.retain(|hit| !is_open(Path::new(&hit.path)) && !recent.iter().any(|recent| recent.as_path() == Path::new(&hit.path)));
        let mut ranked: Vec<FffSearchHit> = open.iter().chain(recent).map(|path| path_hit(path, roots)).collect();
        ranked.extend(hits);
        ranked.truncate(FILE_LIMIT);
        return ranked;
    }
    let (first, rest): (Vec<_>, Vec<_>) = hits.into_iter().partition(|hit| is_open(Path::new(&hit.path)));
    let (mut second, rest): (Vec<_>, Vec<_>) = rest.into_iter().partition(|hit| recent_index(Path::new(&hit.path)).is_some());
    second.sort_by_key(|hit| recent_index(Path::new(&hit.path)));
    first.into_iter().chain(second).chain(rest).collect()
}

impl QuickOpenDelegate {
    pub fn new(
        roots: Vec<PathBuf>,
        sessions: Vec<QuickOpenSession>,
        cx: &mut App,
        on_open: impl Fn(QuickOpenItem, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            roots: roots.clone(),
            sessions,
            agents: Vec::new(),
            tabs: Vec::new(),
            section: Section::Files,
            query: String::new(),
            index: file_index(cx),
            matches: Vec::new(),
            selected: 0,
            searching: None,
            confirm_pending: false,
            generation: Default::default(),
            symbols: None,
            git: Source::Unavailable,
            github: Source::Unavailable,
            file_symbols: Source::Unavailable,
            project_symbols: Vec::new(),
            loads: Vec::new(),
            recent: crate::recent_files::recent_files(cx).in_workspace(&roots, crate::recent_files::now_ms()),
            on_open: Rc::new(on_open),
        }
    }

    /// The files open in tabs other than the active one, in tab order, and the active tab's file.
    fn open_files(&self) -> (Vec<PathBuf>, Option<PathBuf>) {
        let active = self.tabs.iter().find(|tab| tab.active).and_then(|tab| tab.path.clone());
        let mut open: Vec<PathBuf> = Vec::new();
        for path in self.tabs.iter().filter(|tab| !tab.active).filter_map(|tab| tab.path.clone()) {
            if Some(&path) != active.as_ref() && !open.contains(&path) {
                open.push(path);
            }
        }
        (open, active)
    }

    /// One "New chat with …" row per agent instead of a single New chat.
    pub fn with_agents(mut self, agents: Vec<QuickOpenAgent>) -> Self {
        self.agents = agents;
        self
    }

    pub fn with_tabs(mut self, tabs: Vec<QuickOpenTab>) -> Self {
        self.tabs = tabs;
        self
    }

    /// Fills the Git section, loaded when it is first shown; without one it lists no repository.
    pub fn with_git(mut self, load: impl FnOnce(&mut App) -> Task<Option<QuickOpenGit>> + 'static) -> Self {
        self.git = Source::Pending(Box::new(load));
        self
    }

    /// Fills the GitHub section, loaded when it is first shown.
    pub fn with_github(mut self, load: impl FnOnce(&mut App) -> Task<QuickOpenGitHub> + 'static) -> Self {
        self.github = Source::Pending(Box::new(load));
        self
    }

    /// Lists the active file's symbols in the Symbols section, on their own while the query is
    /// empty and before the project's otherwise.
    pub fn with_file_symbols(mut self, load: impl FnOnce(&mut App) -> Task<Vec<WorkspaceSymbol>> + 'static) -> Self {
        self.file_symbols = Source::Pending(Box::new(load));
        self
    }

    fn load_file_symbols(&mut self, cx: &mut Context<Picker<Self>>) {
        let Source::Pending(_) = self.file_symbols else { return };
        let Source::Pending(load) = std::mem::replace(&mut self.file_symbols, Source::Unavailable) else { return };
        let task = load(cx);
        self.file_symbols = Source::Loading;
        self.loads.push(cx.spawn(async move |picker, cx| {
            let symbols = task.await;
            picker
                .update(cx, |picker, cx| {
                    picker.delegate.file_symbols = Source::Loaded(symbols);
                    picker.delegate.refilter(cx);
                })
                .ok();
        }));
    }

    fn load_git(&mut self, cx: &mut Context<Picker<Self>>) {
        let Source::Pending(_) = self.git else { return };
        let Source::Pending(load) = std::mem::replace(&mut self.git, Source::Unavailable) else { return };
        let task = load(cx);
        self.git = Source::Loading;
        self.loads.push(cx.spawn(async move |picker, cx| {
            let git = task.await;
            picker
                .update(cx, |picker, cx| {
                    picker.delegate.git = Source::Loaded(git);
                    picker.delegate.refilter(cx);
                })
                .ok();
        }));
    }

    fn load_github(&mut self, cx: &mut Context<Picker<Self>>) {
        let Source::Pending(_) = self.github else { return };
        let Source::Pending(load) = std::mem::replace(&mut self.github, Source::Unavailable) else { return };
        let task = load(cx);
        self.github = Source::Loading;
        self.loads.push(cx.spawn(async move |picker, cx| {
            let github = task.await;
            picker
                .update(cx, |picker, cx| {
                    picker.delegate.github = Source::Loaded(github);
                    picker.delegate.refilter(cx);
                })
                .ok();
        }));
    }

    /// Filters the Git or GitHub section again once its data arrives.
    fn refilter(&mut self, cx: &mut Context<Picker<Self>>) {
        let (section, query) = self.effective_section(&self.query);
        let query = query.trim().to_string();
        match section {
            Section::Git => self.matches = self.git.loaded().and_then(Option::as_ref).map(|git| git_rows(git, &query).into_iter().map(Match::Git).collect()).unwrap_or_default(),
            Section::GitHub => {
                self.matches = match self.github.loaded() {
                    Some(QuickOpenGitHub::Loaded { pull_requests, issues }) => github_rows(pull_requests, issues, &query).into_iter().map(Match::GitHub).collect(),
                    _ => Vec::new(),
                }
            }
            Section::Symbols => {
                let in_file = file_symbol_matches(self.file_symbols.loaded().map(Vec::as_slice).unwrap_or_default(), &query);
                let lines: std::collections::HashSet<(PathBuf, u32)> = in_file.iter().map(|symbol| (symbol.path.clone(), symbol.line)).collect();
                let in_project = self.project_symbols.iter().filter(|symbol| !lines.contains(&(symbol.path.clone(), symbol.line))).cloned();
                self.matches = in_file.into_iter().map(Match::FileSymbol).chain(in_project.map(Match::Symbol)).collect();
            }
            _ => return,
        }
        self.selected = self.selected.min(self.matches.len().saturating_sub(1));
        cx.notify();
    }

    pub fn with_section(mut self, section: Section) -> Self {
        self.section = section;
        self
    }

    /// The section the query searches: one its prefix names, else the selected one.
    fn effective_section<'a>(&self, query: &'a str) -> (Section, &'a str) {
        match match_prefix(query) {
            Some((section, rest)) if self.section == Section::Files || self.section == section => (section, rest),
            _ => (self.section, query),
        }
    }

    /// Opens the first result when Enter was pressed before the search answered.
    fn confirm_if_pending(picker: &mut Picker<Self>, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        if !std::mem::take(&mut picker.delegate.confirm_pending) || picker.delegate.matches.is_empty() {
            return;
        }
        let index = picker.delegate.selected;
        picker.confirm_index(index, window, cx);
    }

    #[cfg(not(target_family = "wasm"))]
    fn search_text(index: &FffSearch, roots: &[PathBuf], query: &str, stale: &dyn Fn() -> bool) -> Vec<TextMatch> {
        let roots: Vec<&Path> = roots.iter().map(PathBuf::as_path).collect();
        if index.ensure_workspaces(roots.iter().copied()).is_err() {
            return Vec::new();
        }
        if !wait_for_scan(index, &roots, stale) {
            return Vec::new();
        }
        // A regex of the escaped text, safe from the index's query syntax (spaces split, `!x`
        // excluded, `/x/` a path filter), so the text is found as typed.
        let mut pattern: String = query
            .chars()
            .flat_map(|ch| {
                let meta = "\\.+*?()|[]{}^$#&-~".contains(ch);
                meta.then_some('\\').into_iter().chain(std::iter::once(ch))
            })
            .collect::<String>()
            .replace(' ', r"\x20");
        for lead in ['!', '/'] {
            if pattern.starts_with(lead) {
                pattern = format!("[{lead}]{}", &pattern[1..]);
            }
        }
        let options = FffGrepOptions {
            pattern,
            mode: GrepMode::Regex,
            file_offset: 0,
            page_limit: TEXT_SEARCH_MAX_MATCHES,
            // Bounded, so a search for something rare in a large project ends.
            time_budget_ms: 1500,
            before_context: 0,
            after_context: 0,
        };
        index
            .grep(roots.iter().copied(), &options)
            .map(|result| result.matches.iter().take(TEXT_SEARCH_MAX_MATCHES).map(text_match).collect())
            .unwrap_or_default()
    }

    #[cfg(target_family = "wasm")]
    fn search_text(_: &FffSearch, _: &[PathBuf], _: &str, _: &dyn Fn() -> bool) -> Vec<TextMatch> {
        Vec::new()
    }

    fn search_files(index: &FffSearch, roots: &[PathBuf], query: &str, stale: &dyn Fn() -> bool) -> Vec<FffSearchHit> {
        #[cfg(not(target_family = "wasm"))]
        let (remote, roots): (Vec<&PathBuf>, Vec<&PathBuf>) = roots.iter().partition(|root| crate::remote_files::is_remote_root(root));
        #[cfg(not(target_family = "wasm"))]
        if !remote.is_empty() {
            let remote: Vec<&Path> = remote.into_iter().map(PathBuf::as_path).collect();
            let mut hits: Vec<FffSearchHit> = crate::remote_files::search(&remote, query, FILE_LIMIT)
                .into_iter()
                .map(|hit| FffSearchHit { path: hit.path, name: hit.name, relative_path: hit.relative_path, score: hit.score as _ })
                .collect();
            if !roots.is_empty() {
                let local: Vec<PathBuf> = roots.into_iter().cloned().collect();
                hits.extend(Self::search_files(index, &local, query, stale));
                if !query.trim().is_empty() {
                    hits.sort_by(|a, b| b.score.cmp(&a.score));
                }
                hits.truncate(FILE_LIMIT);
            }
            return hits;
        }
        let roots: Vec<&Path> = roots.iter().map(|root| root.as_path()).collect();
        if index.ensure_workspaces(roots.iter().copied()).is_err() {
            return Vec::new();
        }
        if !wait_for_scan(index, &roots, stale) {
            return Vec::new();
        }
        if query.trim().is_empty() {
            return index
                .list_files(roots.iter().copied())
                .map(|files| {
                    files
                        .into_iter()
                        .take(FILE_LIMIT)
                        .map(|file| FffSearchHit { path: file.path, name: file.name, relative_path: file.relative_path, score: 0 })
                        .collect()
                })
                .unwrap_or_default();
        }
        index.search(roots.iter().copied(), query, FILE_LIMIT).unwrap_or_default()
    }
}

impl PickerDelegate for QuickOpenDelegate {
    fn placeholder(&self) -> SharedString {
        self.section.placeholder().into()
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

    fn tabs(&self) -> Vec<(SharedString, bool)> {
        let (current, _) = self.effective_section(&self.query);
        Section::ALL.iter().map(|section| (section.label().into(), *section == current)).collect()
    }

    fn select_tab(&mut self, index: usize, _: &mut Window, _: &mut Context<Picker<Self>>) {
        if let Some(section) = Section::ALL.get(index) {
            self.section = *section;
        }
    }

    fn tab_icon(&self, index: usize) -> Option<IconName> {
        Section::ALL.get(index).map(|section| section.icon())
    }

    fn shows_leading_icon(&self) -> bool {
        false
    }

    fn shows_return_hint(&self) -> bool {
        false
    }

    fn footer(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let subtle = cx.theme().colors.subtle_foreground;
        let hint = |keys: &[&'static str], label: &'static str| {
            div().flex().items_center().gap(px(4.)).children(keys.iter().map(|key| Kbd::new(*key).into_any_element())).child(label)
        };
        let prefixes = Section::ALL.iter().filter_map(|section| section.prefixes().first().map(|prefix| (*prefix, section.label())));
        Some(
            div()
                .flex()
                .w_full()
                .items_center()
                .gap(px(12.))
                .px(px(4.))
                .text_size(typography::TEXT_CAPTION)
                .text_color(subtle)
                .child(hint(&["↑", "↓"], "Navigate"))
                .child(hint(&["↵"], "Open"))
                .child(hint(&["Tab"], "Switch section"))
                .child(div().ml_auto().flex().items_center().gap(px(4.)).children(prefixes.map(|(prefix, label)| {
                    div().flex().items_center().gap(px(4.)).child(Kbd::new(prefix)).child(label)
                })))
                .into_any_element(),
        )
    }

    fn leading_icon(&self) -> IconName {
        self.effective_section(&self.query).0.icon()
    }

    fn update_matches(&mut self, query: &str, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        self.query = query.to_string();
        self.confirm_pending = false;
        let generation = self.generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        let latest = self.generation.clone();
        let stale = move || latest.load(std::sync::atomic::Ordering::Relaxed) != generation;
        let (section, query) = self.effective_section(query);
        let query = query.to_string();
        self.symbols = (section == Section::Symbols).then(|| query.trim().to_string());
        self.matches.clear();
        self.selected = 0;
        self.searching = None;
        match section {
            Section::Git => {
                self.load_git(cx);
                self.refilter(cx);
            }
            Section::GitHub => {
                self.load_github(cx);
                self.refilter(cx);
            }
            Section::Symbols => {
                self.load_file_symbols(cx);
                self.project_symbols.clear();
                self.refilter(cx);
                let symbols = query.trim();
                if symbols.is_empty() || self.roots.is_empty() {
                    return;
                }
                let Some(store) = LspStore::try_global(cx) else { return };
                let search = store.read(cx).workspace_symbols(symbols, &self.roots);
                self.searching = Some(cx.spawn_in(window, async move |picker, cx| {
                    let symbols = search.await;
                    picker
                        .update_in(cx, |picker, window, cx| {
                            picker.delegate.searching = None;
                            picker.delegate.project_symbols = symbols;
                            picker.delegate.refilter(cx);
                            Self::confirm_if_pending(picker, window, cx);
                        })
                        .ok();
                }));
            }
            Section::Text => {
                let text = query.trim().to_string();
                if text.chars().count() < TEXT_SEARCH_MIN_LENGTH || self.roots.is_empty() {
                    return;
                }
                let (index, roots) = (self.index.clone(), self.roots.clone());
                self.searching = Some(cx.spawn_in(window, async move |picker, cx| {
                    // The pause first: a keystroke within it drops this task before any grep runs
                    // (a started grep cannot be stopped, so each keystroke used to search the
                    // whole project).
                    cx.background_executor().timer(Duration::from_millis(200)).await;
                    let found = cx.background_spawn(async move { Self::search_text(&index, &roots, &text, &stale) }).await;
                    picker
                        .update_in(cx, |picker, window, cx| {
                            picker.delegate.searching = None;
                            picker.delegate.matches = found.into_iter().map(Match::Text).collect();
                            cx.notify();
                            Self::confirm_if_pending(picker, window, cx);
                        })
                        .ok();
                }));
            }
            Section::Agents => {
                let mut sessions: Vec<(usize, FuzzyMatch)> = self
                    .sessions
                    .iter()
                    .enumerate()
                    .filter_map(|(index, session)| {
                        let text = format!("{} {}", session.title, session.project.clone().unwrap_or_default());
                        fuzzy_match(&query, &text).map(|matched| (index, matched))
                    })
                    .collect();
                if !query.trim().is_empty() {
                    sessions.sort_by(|a, b| b.1.score.cmp(&a.1.score));
                }
                let sessions = sessions.into_iter().map(|(index, matched)| Match::Session(index, matched));
                let start: Vec<Match> = if self.agents.is_empty() {
                    fuzzy_match(&query, "new start chat").is_some().then_some(Match::NewSession).into_iter().collect()
                } else {
                    self.agents
                        .iter()
                        .enumerate()
                        .filter_map(|(index, agent)| {
                            let matched = if query.trim().is_empty() { fuzzy_match("", &agent.name) } else { fuzzy_match(&query, &agent.name).or_else(|| fuzzy_match(&query, "new start chat").map(|_| FuzzyMatch { score: 0, positions: Vec::new() })) };
                            matched.map(|matched| Match::NewAgent(index, matched))
                        })
                        .collect()
                };
                self.matches = if query.trim().is_empty() { start.into_iter().chain(sessions).collect() } else { sessions.chain(start).collect() };
            }
            Section::Tabs => {
                let mut tabs: Vec<(usize, FuzzyMatch)> = self
                    .tabs
                    .iter()
                    .enumerate()
                    .filter_map(|(index, tab)| fuzzy_match(&query, &format!("{} {}", tab.title, tab.description)).map(|matched| (index, matched)))
                    .collect();
                if !query.trim().is_empty() {
                    tabs.sort_by(|a, b| b.1.score.cmp(&a.1.score));
                }
                self.matches = tabs.into_iter().map(|(index, matched)| Match::Tab(index, matched)).collect();
            }
            Section::Files => {
                if self.roots.is_empty() {
                    return;
                }
                let (index, roots) = (self.index.clone(), self.roots.clone());
                let (open, active) = self.open_files();
                let recent = self.recent.clone();
                let search = cx.background_spawn(async move {
                    let hits = Self::search_files(&index, &roots, &query, &stale);
                    let recent: Vec<PathBuf> = if query.trim().is_empty() { recent.into_iter().filter(|path| crate::recent_files::still_there(path)).collect() } else { recent };
                    rank_file_hits(hits, &open, &recent, active.as_deref(), &roots, &query)
                });
                self.searching = Some(cx.spawn_in(window, async move |picker, cx| {
                    let hits = search.await;
                    picker
                        .update_in(cx, |picker, window, cx| {
                            picker.delegate.searching = None;
                            picker.delegate.matches = hits.into_iter().map(Match::File).collect();
                            cx.notify();
                            Self::confirm_if_pending(picker, window, cx);
                        })
                        .ok();
                }));
            }
        }
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let current = self.matches.get(index)?;
        let previous = index.checked_sub(1).and_then(|previous| self.matches.get(previous));
        match (previous, current) {
            (None | Some(Match::NewSession | Match::NewAgent(..)), Match::Session(..)) => Some("Chats".into()),
            (None | Some(Match::Session(..)), Match::NewSession | Match::NewAgent(..)) => Some("Start a chat".into()),
            (None, Match::FileSymbol(_)) => Some("This file".into()),
            (None | Some(Match::FileSymbol(_)), Match::Symbol(_)) => Some("Project".into()),
            (previous, Match::Git(row)) => match previous {
                Some(Match::Git(previous)) if previous.group() == row.group() => None,
                _ => Some(row.group().into()),
            },
            (previous, Match::GitHub(row)) => match previous {
                Some(Match::GitHub(previous)) if previous.group() == row.group() => None,
                _ => Some(row.group().into()),
            },
            _ => None,
        }
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        let query = self.effective_section(&self.query).1.trim().to_string();
        match &self.matches[index] {
            Match::Git(row) => {
                let Some(Some(git)) = self.git.loaded() else { return gpui::Empty.into_any_element() };
                let colors = cx.theme().colors.clone();
                match row {
                    GitRow::Change(change) => {
                        let change = &git.changes[*change];
                        let name = file_name(&change.path).to_string();
                        let mut labels: Vec<SharedString> = Vec::new();
                        if change.staged {
                            labels.push("Staged".into());
                        }
                        labels.push(change.status.into());
                        PaletteRow::new(name.clone())
                            .file_icon(name.clone())
                            .description(folder(&change.path).to_string())
                            .inline()
                            .highlights(substring_positions(&name, &query))
                            .accessory(badges(labels, selected, cx))
                            .selected(selected)
                            .into_any_element()
                    }
                    GitRow::Branch(branch) => {
                        let branch = &git.branches[*branch];
                        let current = git.current_branch.as_deref() == Some(branch.as_str());
                        let mut row = PaletteRow::new(branch.clone())
                            .icon(IconName::GitBranch)
                            .description(if current { "Current branch" } else { "Switch to this branch" })
                            .inline()
                            .highlights(substring_positions(branch, &query))
                            .selected(selected);
                        if current {
                            row = row.accessory(ui::Icon::new(IconName::Check).size(ui::IconSize::Small).color(if selected { colors.primary_foreground } else { colors.primary }));
                        }
                        row.into_any_element()
                    }
                    GitRow::Commit(commit) => {
                        let commit = &git.commits[*commit];
                        let short: String = commit.hash.chars().take(7).collect();
                        PaletteRow::new(commit.message.clone())
                            .icon(IconName::GitCommit)
                            .description(format!("{} · {}", commit.author, commit.date))
                            .inline()
                            .highlights(substring_positions(&commit.message, &query))
                            .accessory(badges(vec![short.into()], selected, cx))
                            .selected(selected)
                            .into_any_element()
                    }
                }
            }
            Match::GitHub(row) => {
                let Some(QuickOpenGitHub::Loaded { pull_requests, issues }) = self.github.loaded() else { return gpui::Empty.into_any_element() };
                let colors = cx.theme().colors.clone();
                let icon = |name: IconName, color: gpui::Hsla| ui::Icon::new(name).size(ui::IconSize::Medium).color(if selected { colors.primary_foreground } else { color });
                match row {
                    GitHubRow::PullRequest(pr) => {
                        let pr = &pull_requests[*pr];
                        let mut labels: Vec<SharedString> = Vec::new();
                        if pr.draft {
                            labels.push("Draft".into());
                        }
                        labels.push(format!("#{}", pr.number).into());
                        PaletteRow::new(pr.title.clone())
                            .leading(icon(IconName::GitPullRequest, if pr.draft { colors.muted_foreground } else { colors.success }))
                            .description(format!("{} · {} → {}", pr.author, pr.head, pr.base))
                            .inline()
                            .highlights(substring_positions(&pr.title, &query))
                            .accessory(badges(labels, selected, cx))
                            .selected(selected)
                            .into_any_element()
                    }
                    GitHubRow::Issue(issue) => {
                        let issue = &issues[*issue];
                        PaletteRow::new(issue.title.clone())
                            .leading(icon(IconName::CircleDot, colors.success))
                            .description(std::iter::once(issue.author.clone()).chain(issue.labels.iter().cloned()).collect::<Vec<_>>().join(" · "))
                            .inline()
                            .highlights(substring_positions(&issue.title, &query))
                            .accessory(badges(vec![format!("#{}", issue.number).into()], selected, cx))
                            .selected(selected)
                            .into_any_element()
                    }
                }
            }
            Match::Session(session_index, matched) => {
                let session = &self.sessions[*session_index];
                let title = if session.title.is_empty() { "New Session".to_string() } else { session.title.clone() };
                PaletteRow::new(title)
                    .icon(IconName::Sparkle)
                    .description(session.project.clone().unwrap_or_else(|| "Chat".into()))
                    .inline()
                    .highlights(matched.positions.clone())
                    .selected(selected)
                    .into_any_element()
            }
            Match::NewSession => PaletteRow::new("New chat").icon(IconName::Plus).description("Start an agent chat").inline().selected(selected).into_any_element(),
            Match::NewAgent(agent_index, matched) => {
                let agent = &self.agents[*agent_index];
                let prefix = "New chat with ";
                let positions = matched.positions.iter().map(|position| position + prefix.len()).collect();
                let row = PaletteRow::new(format!("{prefix}{}", agent.name)).icon(IconName::Plus).description(agent.description.clone()).inline().highlights(positions).selected(selected);
                if agent.current { row.badge("Current").into_any_element() } else { row.into_any_element() }
            }
            Match::File(hit) => {
                let directory = Path::new(&hit.relative_path)
                    .parent()
                    .map(|parent| parent.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let open = self.tabs.iter().any(|tab| !tab.active && tab.path.as_deref() == Some(Path::new(&hit.path)));
                let row = PaletteRow::new(hit.name.clone()).file_icon(hit.name.clone()).description(directory).inline().selected(selected);
                if open {
                    row.badge("Open").into_any_element()
                } else if self.recent.iter().any(|recent| recent.as_path() == Path::new(&hit.path)) {
                    let colors = &cx.theme().colors;
                    row.accessory(
                        gpui::div()
                            .flex()
                            .items_center()
                            .px(gpui::px(6.))
                            .py(gpui::px(2.))
                            .rounded_full()
                            .bg(if selected { colors.primary_foreground.opacity(0.2) } else { colors.accent })
                            .child(ui::Icon::new(IconName::Clock).size(ui::IconSize::XSmall).color(if selected { colors.primary_foreground } else { colors.muted_foreground })),
                    )
                    .into_any_element()
                } else {
                    row.into_any_element()
                }
            }
            Match::Symbol(symbol) => {
                let file = symbol.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                PaletteRow::new(symbol.name.clone())
                    .icon(symbol_icon(symbol.kind))
                    .description(match &symbol.container_name {
                        Some(container) => format!("{container} · {file} · {} :{}", symbol.kind_label(), symbol.line + 1),
                        None => format!("{file} · {} :{}", symbol.kind_label(), symbol.line + 1),
                    })
                    .inline()
                    .selected(selected)
                    .into_any_element()
            }
            Match::FileSymbol(symbol) => PaletteRow::new(symbol.name.clone())
                .icon(symbol_icon(symbol.kind))
                .description(match &symbol.container_name {
                    Some(container) => format!("{container} · {} :{}", symbol.kind_label(), symbol.line + 1),
                    None => format!("{} :{}", symbol.kind_label(), symbol.line + 1),
                })
                .inline()
                .selected(selected)
                .into_any_element(),
            Match::Text(found) => {
                let name = found.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                let directory = self
                    .roots
                    .iter()
                    .find_map(|root| found.path.parent()?.strip_prefix(root).ok())
                    .map(|dir| dir.to_string_lossy().into_owned())
                    .unwrap_or_default();
                PaletteRow::new(found.excerpt.clone())
                    .file_icon(name.clone())
                    .description(if directory.is_empty() { name } else { format!("{name} · {directory}") })
                    .badge(format!(":{}", found.line))
                    .selected(selected)
                    .into_any_element()
            }
            Match::Tab(tab_index, matched) => {
                let tab = &self.tabs[*tab_index];
                let colors = cx.theme().colors.clone();
                let mut row = PaletteRow::new(tab.title.clone())
                    .icon(tab.icon)
                    .when_some(tab.path.as_ref().and_then(|path| path.file_name()), |row, name| row.file_icon(name.to_string_lossy().into_owned()))
                    .description(tab.description.clone())
                    .inline()
                    .highlights(matched.positions.clone())
                    .selected(selected);
                if tab.dirty || tab.pinned {
                    row = row.accessory(
                        gpui::div()
                            .flex()
                            .items_center()
                            .gap(gpui::px(6.))
                            .when(tab.dirty, |this| this.child(gpui::div().size(gpui::px(8.)).rounded_full().bg(colors.primary)))
                            .when(tab.pinned, |this| this.child(ui::Icon::new(IconName::Pin).size(ui::IconSize::Small).color(colors.muted_foreground))),
                    );
                }
                if tab.active {
                    row = row.badge("Active");
                }
                row.into_any_element()
            }
        }
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let item = match self.matches.get(index) {
            Some(Match::Session(session_index, _)) => QuickOpenItem::Session(self.sessions[*session_index].id.clone()),
            Some(Match::NewSession) => QuickOpenItem::NewSession,
            Some(Match::NewAgent(agent_index, _)) => QuickOpenItem::NewAgentSession(self.agents[*agent_index].id.clone()),
            Some(Match::File(hit)) => {
                let path = PathBuf::from(&hit.path);
                let workspace = self.roots.iter().find(|root| path.starts_with(root)).or(self.roots.first()).cloned();
                crate::recent_files::recent_files(cx).record(&path, workspace.as_deref(), crate::recent_files::now_ms());
                QuickOpenItem::File(path)
            }
            Some(Match::Symbol(symbol) | Match::FileSymbol(symbol)) => QuickOpenItem::Symbol { path: symbol.path.clone(), line: symbol.line + 1, column: symbol.character + 1 },
            Some(Match::Text(found)) => QuickOpenItem::Text { path: found.path.clone(), line: found.line, column: found.column },
            Some(Match::Tab(tab_index, _)) => {
                let tab = &self.tabs[*tab_index];
                QuickOpenItem::Tab { group: tab.group, index: tab.index }
            }
            Some(Match::Git(row)) => {
                let Some(Some(git)) = self.git.loaded() else { return false };
                let repo = git.repo.clone();
                match row {
                    GitRow::Change(change) => {
                        let change = &git.changes[*change];
                        QuickOpenItem::GitChange { repo, path: change.path.clone(), staged: change.staged }
                    }
                    GitRow::Branch(branch) => {
                        let name = git.branches[*branch].clone();
                        let current = git.current_branch.as_deref() == Some(name.as_str());
                        QuickOpenItem::Branch { repo, name, current }
                    }
                    GitRow::Commit(commit) => {
                        let commit = &git.commits[*commit];
                        QuickOpenItem::Commit { repo, hash: commit.hash.clone(), message: commit.message.clone() }
                    }
                }
            }
            Some(Match::GitHub(row)) => {
                let Some(QuickOpenGitHub::Loaded { pull_requests, issues }) = self.github.loaded() else { return false };
                match row {
                    GitHubRow::PullRequest(pr) => QuickOpenItem::PullRequest { number: pull_requests[*pr].number, title: pull_requests[*pr].title.clone() },
                    GitHubRow::Issue(issue) => QuickOpenItem::Issue { number: issues[*issue].number, title: issues[*issue].title.clone() },
                }
            }
            None => return false,
        };
        (self.on_open)(item, window, cx);
        true
    }

    fn confirm_when_ready(&mut self, _: &mut Context<Picker<Self>>) {
        self.confirm_pending = self.searching.is_some();
    }

    fn empty_message(&self) -> SharedString {
        let (section, query) = self.effective_section(&self.query);
        let query = query.trim();
        match section {
            Section::Files | Section::Text | Section::Symbols if self.roots.is_empty() => match section {
                Section::Text => "Open a folder to search text in its files".into(),
                Section::Files => "Open a folder to start searching files".into(),
                _ => "Open a project to search its files".into(),
            },
            Section::Symbols if self.searching.is_some() || self.file_symbols.is_loading() => "Loading symbols...".into(),
            Section::Symbols if query.is_empty() => "No symbols in this file. Type to search the project".into(),
            Section::Symbols => "No matching symbols".into(),
            Section::Text if query.chars().count() < TEXT_SEARCH_MIN_LENGTH => "Type at least two characters to search file contents".into(),
            Section::Text if self.searching.is_some() => "Searching files...".into(),
            Section::Text => "No matches in the project".into(),
            Section::Agents if query.is_empty() => "No agent chats yet".into(),
            Section::Agents => "No matching chats or agents".into(),
            Section::Git => match &self.git {
                Source::Unavailable | Source::Loaded(None) => "Open a folder that is a Git repository".into(),
                _ if self.git.is_loading() => "Loading repository...".into(),
                _ if !query.is_empty() => "No matching changes, branches or commits".into(),
                _ => "No changes, branches or commits".into(),
            },
            Section::GitHub => match &self.github {
                Source::Unavailable | Source::Loaded(QuickOpenGitHub::NoRepository) => "Open a folder with a GitHub repository".into(),
                Source::Loaded(QuickOpenGitHub::SignedOut) => "Sign in to GitHub to search pull requests and issues".into(),
                _ if self.github.is_loading() => "Loading pull requests and issues...".into(),
                _ if !query.is_empty() => "No matching pull requests or issues".into(),
                _ => "No open pull requests or issues".into(),
            },
            Section::Tabs if query.is_empty() => "No open tabs".into(),
            Section::Tabs => "No matching tabs".into(),
            Section::Files if query.is_empty() => "No files found in project".into(),
            Section::Files => "No matching files found".into(),
        }
    }
}

/// The web build's file index: the project's files as the workspace server lists them, fuzzy
/// matched here.
#[cfg(target_family = "wasm")]
mod web_index {
    use std::{
        collections::HashMap,
        path::{Path, PathBuf},
        sync::{Arc, Mutex, OnceLock},
        time::Duration,
    };

    use crate::fuzzy_match;

    pub type FileLister = Arc<dyn Fn(&Path) -> Vec<PathBuf> + Send + Sync>;

    static LISTER: OnceLock<FileLister> = OnceLock::new();

    /// How the web build lists a project's files (absolute paths).
    pub fn set_file_lister(lister: FileLister) {
        let _ = LISTER.set(lister);
    }

    pub struct FffSearchHit {
        pub path: String,
        pub name: String,
        pub relative_path: String,
        pub score: i64,
    }

    pub struct FffSearch {
        files: Mutex<HashMap<PathBuf, Arc<Vec<FffSearchHit>>>>,
    }

    impl FffSearch {
        pub fn without_frecency(_: bool) -> Self {
            Self { files: Mutex::new(HashMap::new()) }
        }

        pub fn ensure_workspaces<'a>(&self, roots: impl IntoIterator<Item = &'a Path>) -> Result<(), ()> {
            let lister = LISTER.get().ok_or(())?;
            let mut files = self.files.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            for root in roots {
                if files.contains_key(root) {
                    continue;
                }
                let listed = lister(root)
                    .into_iter()
                    .map(|path| {
                        let relative_path = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned();
                        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                        FffSearchHit { path: path.to_string_lossy().into_owned(), name, relative_path, score: 0 }
                    })
                    .collect();
                files.insert(root.to_path_buf(), Arc::new(listed));
            }
            Ok(())
        }

        pub fn wait_for_scan<'a>(&self, _: impl IntoIterator<Item = &'a Path>, _: Duration) -> Result<(), ()> {
            Ok(())
        }

        fn each<'a>(&self, roots: impl IntoIterator<Item = &'a Path>, mut visit: impl FnMut(&FffSearchHit)) {
            let files = self.files.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            for root in roots {
                for file in files.get(root).into_iter().flat_map(|files| files.iter()) {
                    visit(file);
                }
            }
        }

        pub fn list_files<'a>(&self, roots: impl IntoIterator<Item = &'a Path>) -> Result<Vec<FffSearchHit>, ()> {
            let mut out = Vec::new();
            self.each(roots, |file| out.push(FffSearchHit { path: file.path.clone(), name: file.name.clone(), relative_path: file.relative_path.clone(), score: 0 }));
            Ok(out)
        }

        pub fn search<'a>(&self, roots: impl IntoIterator<Item = &'a Path>, query: &str, limit: usize) -> Result<Vec<FffSearchHit>, ()> {
            let mut out = Vec::new();
            self.each(roots, |file| {
                if let Some(matched) = fuzzy_match(query, &file.relative_path) {
                    out.push(FffSearchHit { path: file.path.clone(), name: file.name.clone(), relative_path: file.relative_path.clone(), score: matched.score });
                }
            });
            out.sort_by(|a, b| b.score.cmp(&a.score));
            out.truncate(limit);
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{FffSearchHit, Section, WorkspaceSymbol, file_symbol_matches, match_prefix, rank_file_hits};

    #[gpui::test]
    fn the_shared_index_answers_a_query_at_once(cx: &mut gpui::TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("README.md"), "").unwrap();
        let roots = vec![dir.path().to_path_buf()];
        let mut hits = Vec::new();
        for _ in 0..50 {
            hits = cx.update(|cx| super::search_file_index(&roots, "main", 10, cx));
            if !hits.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(hits.first().map(|hit| hit.relative_path.as_str()), Some("src/main.rs"));
    }

    #[test]
    fn frecency_store_records_opens_in_a_temporary_folder() {
        let dir = std::env::temp_dir().join(format!("athas-fff-frecency-{}", std::process::id()));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("main.rs"), "fn main() {}").unwrap();
        let index = super::new_file_index(Some(dir.join("fff-frecency.lmdb")));
        index.track_access(&project.join("main.rs")).unwrap();
        assert!(dir.join("fff-frecency.lmdb").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn watcher_changes_reach_the_file_index() {
        let dir = std::env::temp_dir().join(format!("athas-fff-changes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("first.rs"), "").unwrap();
        let root = dir.canonicalize().unwrap();
        let index = super::new_file_index(None);
        index.ensure_workspaces([root.as_path()]).unwrap();
        index.wait_for_scan([root.as_path()], std::time::Duration::from_secs(10)).unwrap();
        let found = |name: &str| index.search([root.as_path()], name, 10).unwrap().iter().any(|hit| hit.name == name);
        assert!(found("first.rs"));
        std::fs::write(root.join("brandnew.rs"), "").unwrap();
        std::fs::remove_file(root.join("first.rs")).unwrap();
        let (changes, git_changed) = super::fff_changes(&[root.join("brandnew.rs"), root.join("first.rs"), root.join(".git/index")]);
        assert!(git_changed);
        assert_eq!(changes.len(), 2);
        assert!(!changes[0].removed && changes[1].removed);
        index.apply_changes(&root, &changes, false, git_changed).unwrap();
        assert!(found("brandnew.rs"));
        assert!(!found("first.rs"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_files_lead_and_the_active_one_is_left_out() {
        let hit = |path: &str, score| FffSearchHit {
            path: path.into(),
            name: Path::new(path).file_name().unwrap().to_string_lossy().into_owned(),
            relative_path: path.trim_start_matches("/p/").into(),
            score,
        };
        let hits = vec![hit("/p/a.rs", 9), hit("/p/src/b.rs", 5), hit("/p/c.rs", 3)];
        let open = [PathBuf::from("/p/src/b.rs"), PathBuf::from("/p/d.rs")];
        let roots = [PathBuf::from("/p")];
        let ranked = rank_file_hits(hits.clone(), &open, &[], Some(Path::new("/p/c.rs")), &roots, "rs");
        let paths: Vec<&str> = ranked.iter().map(|hit| hit.path.as_str()).collect();
        assert_eq!(paths, ["/p/src/b.rs", "/p/a.rs"]);
        let ranked = rank_file_hits(hits, &open, &[], Some(Path::new("/p/c.rs")), &roots, "");
        let paths: Vec<&str> = ranked.iter().map(|hit| hit.path.as_str()).collect();
        assert_eq!(paths, ["/p/src/b.rs", "/p/d.rs", "/p/a.rs"]);
        assert_eq!(ranked[0].relative_path, "src/b.rs");
    }

    #[test]
    fn recent_files_follow_the_open_ones() {
        let hit = |path: &str| FffSearchHit {
            path: path.into(),
            name: Path::new(path).file_name().unwrap().to_string_lossy().into_owned(),
            relative_path: path.trim_start_matches("/p/").into(),
            score: 0,
        };
        let hits = vec![hit("/p/a.rs"), hit("/p/b.rs"), hit("/p/c.rs"), hit("/p/e.rs")];
        let open = [PathBuf::from("/p/a.rs")];
        let recent = [PathBuf::from("/p/e.rs"), PathBuf::from("/p/a.rs"), PathBuf::from("/p/f.rs"), PathBuf::from("/p/c.rs")];
        let roots = [PathBuf::from("/p")];
        let paths = |ranked: Vec<FffSearchHit>| ranked.into_iter().map(|hit| hit.path).collect::<Vec<_>>();
        assert_eq!(paths(rank_file_hits(hits.clone(), &open, &recent, None, &roots, "")), ["/p/a.rs", "/p/e.rs", "/p/f.rs", "/p/c.rs", "/p/b.rs"]);
        assert_eq!(paths(rank_file_hits(hits, &open, &recent, Some(Path::new("/p/e.rs")), &roots, "rs")), ["/p/a.rs", "/p/c.rs", "/p/b.rs"]);
    }
    use lsp_client::lsp::SymbolKind;

    #[test]
    fn file_symbols_sort_by_kind_or_score() {
        let symbol = |name: &str, kind: SymbolKind, line: u32| WorkspaceSymbol {
            name: name.into(),
            kind,
            container_name: None,
            path: "/p/a.rs".into(),
            line,
            character: 0,
        };
        let symbols = vec![symbol("helper", SymbolKind::FUNCTION, 1), symbol("Config", SymbolKind::STRUCT, 9), symbol("MAX", SymbolKind::CONSTANT, 0)];
        let names = |found: Vec<WorkspaceSymbol>| found.into_iter().map(|symbol| symbol.name).collect::<Vec<_>>();
        assert_eq!(names(file_symbol_matches(&symbols, "")), vec!["Config", "helper", "MAX"]);
        assert_eq!(names(file_symbol_matches(&symbols, "hlp")), vec!["helper"]);
    }

    #[test]
    fn prefixes_lead_to_their_sections() {
        assert_eq!(match_prefix("%  todo"), Some((Section::Text, "todo")));
        assert_eq!(match_prefix("#Matrix"), Some((Section::Symbols, "Matrix")));
        assert_eq!(match_prefix("main.rs"), None);
    }
}
