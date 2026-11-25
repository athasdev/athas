//! The Source Control tool (`features/git`): the branch, the commit box, staged and unstaged
//! changes, stashes, history, branches, worktrees, remotes and tags. Change, history and stash
//! rows open diff and commit tabs (`git_diff`) through `workbench_api`.
//!
//! Git work runs on the background executor through [`repository::GitRepository`]; results come
//! back with `this.update`. The status is polled every few seconds while the window is active and
//! reloaded whenever the window comes back to the front.

mod command_surface;
mod commit_message;
mod model;
mod repository;
mod section_panel;
mod view;

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Result;
use gpui::{
    Anchor, AnyElement, AppContext, ClipboardItem, Context, Entity, EventEmitter, FocusHandle, Focusable,
    PathPromptOptions, Pixels, Point, SharedString, Subscription, Task, Window,
};
use ui::{InputAppearance, MenuEntry, MenuItem, OpenMenu, TextArea, TextAreaEvent, TextAreaVariant, TextInput, TextInputEvent};

use model::{ChangeFile, CommitScope, Groups, can_discard, change_files, group, plural, visible_changes};
use git_diff::{DiffTarget, Scope};
use repository::{Remote, Tag, Worktree};
pub use repository::{
    Checkout, Commit, CommitTotals, DiffStat, Discover, FileStatus, GitRepository, RemoteOp, Stash, StashAction, StatusEntry, WorkingTree,
};
pub use repository::discover as discover_repository;
#[cfg(target_family = "wasm")]
pub use repository::set_discover;
#[cfg(not(target_family = "wasm"))]
pub use repository::{RemoteInit, set_remote_init};
pub use section_panel::SectionBody;
pub use commit_message::{CommitMessageGenerator, CommitMessageRequest, set_commit_message_generator};

gpui::actions!(git, [StageAll, UnstageAll, CommitChanges, Push, Pull, Fetch, DiscardAll, Refresh]);

/// Registers the `git.*` commands. The workbench handles their actions, since the panel is
/// rarely focused when one runs.
pub fn init(cx: &mut gpui::App) {
    keymap::register(cx, "git.stageAll", StageAll);
    keymap::register(cx, "git.unstageAll", UnstageAll);
    keymap::register(cx, "git.commit", CommitChanges);
    keymap::register(cx, "git.push", Push);
    keymap::register(cx, "git.pull", Pull);
    keymap::register(cx, "git.fetch", Fetch);
    keymap::register(cx, "git.discardAll", DiscardAll);
    keymap::register(cx, "git.refresh", Refresh);
}

/// How often the status is re-read while the window is active.
const POLL_INTERVAL: Duration = Duration::from_secs(4);
/// Commits the history loads at a time.
const COMMIT_PAGE: usize = 50;
/// How long a success notice stays.

/// The Git settings the panel follows, read again whenever the settings change.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GitSettings {
    pub auto_refresh: bool,
    pub confirm_discard: bool,
    pub auto_fetch_minutes: f64,
    pub pull_rebase: bool,
    pub sign_off: bool,
    pub default_branch: String,
    pub show_untracked: bool,
    pub staged_first: bool,
    pub folder_view: bool,
    pub remember_mode: bool,
    pub last_mode: String,
    pub compact_badges: bool,
    /// Views and repository items hidden from the sidebar (`hiddenGitSidebarItems`).
    pub hidden_items: Vec<String>,
}

impl GitSettings {
    fn from_settings(settings: &settings::Settings) -> Self {
        Self {
            auto_refresh: settings.auto_refresh_git_status,
            confirm_discard: settings.confirmbefore_discard,
            auto_fetch_minutes: settings.git_auto_fetch_interval,
            pull_rebase: settings.git_pull_rebase,
            sign_off: settings.git_sign_off_commits,
            default_branch: settings.git_default_branch_name.clone(),
            show_untracked: settings.show_untracked_files,
            staged_first: settings.show_staged_first,
            folder_view: settings.git_changes_folder_view,
            remember_mode: settings.remember_last_git_panel_mode,
            last_mode: settings.git_last_panel_mode.clone(),
            compact_badges: settings.compact_git_status_badges,
            hidden_items: settings.hidden_git_sidebar_items.clone(),
        }
    }

    fn read(cx: &gpui::App) -> Self {
        match cx.try_global::<settings::SettingsStore>() {
            Some(_) => Self::from_settings(settings::get(cx)),
            None => Self::from_settings(&settings::Settings::default()),
        }
    }
}

/// What a `git.*` command asks of the panel. Commands that arrive while the repository is still
/// being found wait for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitCommand {
    StageAll,
    UnstageAll,
    Commit,
    Push,
    Pull,
    Fetch,
    DiscardAll,
    Refresh,
}

#[derive(Clone, Debug, PartialEq)]
pub enum GitPanelEvent {
    /// Open the file at this path in the centre.
    OpenFile(PathBuf),
    /// Show this list in the secondary column, or close the column when it is `None`.
    OpenSection(Option<GitSection>),
}

enum RepoState {
    Discovering,
    /// The folder is not inside a repository, or reading it failed.
    Missing { error: Option<SharedString> },
    Ready(Arc<dyn GitRepository>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Reload {
    /// The working tree only: what polling reads.
    Status,
    /// Also branches, stashes and history.
    Full,
}

/// The lists the Source Control sidebar's footer opens in the secondary column: History, then
/// the three that used to open a command surface. Changes is not among them -- it is the panel
/// itself, always open, so it needs no row to unfold it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GitSection {
    History,
    Stashes,
    Remotes,
    Tags,
}

impl GitSection {
    /// The footer row that opens it, so the row reads as pressed while it is open.
    pub fn row_id(self) -> &'static str {
        match self {
            GitSection::History => "git-history",
            GitSection::Stashes => "git-stashes",
            GitSection::Remotes => "git-remotes",
            GitSection::Tags => "git-tags",
        }
    }

    /// The name under `hiddenGitSidebarItems`, and the one a snapshot asks for.
    pub fn key(self) -> &'static str {
        match self {
            GitSection::History => "history",
            GitSection::Stashes => "stashes",
            GitSection::Remotes => "remotes",
            GitSection::Tags => "tags",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            GitSection::History => "History",
            GitSection::Stashes => "Stashes",
            GitSection::Remotes => "Remotes",
            GitSection::Tags => "Tags",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Some(match key {
            "history" => GitSection::History,
            "stashes" => GitSection::Stashes,
            "remotes" => GitSection::Remotes,
            "tags" => GitSection::Tags,
            _ => return None,
        })
    }
}

/// What the two-field form at the top of the Worktrees, Remotes and Tags tabs creates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DraftKind {
    /// Folder, then a new branch name (empty: detached at HEAD).
    Worktree,
    /// Name, then URL.
    Remote,
    /// Name, then an optional message for an annotated tag.
    Tag,
}

impl DraftKind {
    fn placeholders(self) -> (&'static str, &'static str) {
        match self {
            DraftKind::Worktree => ("Folder for the new worktree", "New branch (empty to detach)"),
            DraftKind::Remote => ("origin", "git@github.com:owner/repo.git"),
            DraftKind::Tag => ("v1.0.0", "Message (optional)"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Section {
    Staged,
    Changes,
    History,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tone {
    Success,
    Warning,
    Error,
}

#[derive(Clone, Debug)]
enum NoticeAction {
    StashAndSwitch(String),
    /// Discard the files although no copy could be kept in Local History.
    DiscardWithoutCopy(Vec<ChangeFile>),
    /// `git worktree prune`: drops worktree records whose folder is gone or broken.
    PruneWorktrees,
    /// Removes the worktree with its uncommitted changes (`--force`).
    ForceRemoveWorktree(String),
}

impl NoticeAction {
    fn label(&self) -> &'static str {
        match self {
            NoticeAction::StashAndSwitch(_) => "Stash & Switch",
            NoticeAction::DiscardWithoutCopy(_) => "Discard Anyway",
            NoticeAction::PruneWorktrees => "Prune",
            NoticeAction::ForceRemoveWorktree(_) => "Force Remove",
        }
    }
}

/// What a failed `git worktree remove` means, said plainly, and the action that fixes it.
fn worktree_removal_problem(error: &str, path: &str, forced: bool) -> (String, Option<NoticeAction>) {
    let lower = error.to_lowercase();
    if lower.contains("does not exist") || lower.contains("is not a working tree") || lower.contains("not a valid") {
        (
            "Couldn't remove the worktree: its folder is no longer a Git worktree: Prune removes the stale record; the folder itself stays".into(),
            Some(NoticeAction::PruneWorktrees),
        )
    } else if !forced && (lower.contains("modified or untracked") || lower.contains("contains modified") || lower.contains("uncommitted")) {
        (
            "The worktree has uncommitted changes: Force Remove deletes the folder with them".into(),
            Some(NoticeAction::ForceRemoveWorktree(path.to_string())),
        )
    } else if lower.contains("locked") {
        ("Couldn't remove the worktree: it is locked: unlock it with `git worktree unlock` first".into(), None)
    } else {
        (format!("Couldn't remove the worktree: {}", clean_git_error(error)), None)
    }
}

/// A git error as a person reads it: without the "Git <command> failed: fatal:" prefixes.
fn clean_git_error(error: &str) -> String {
    let mut text = error.trim();
    loop {
        let before = text;
        for prefix in ["fatal:", "error:"] {
            if let Some(rest) = text.strip_prefix(prefix) {
                text = rest.trim_start();
            }
        }
        if let Some((head, rest)) = text.split_once(": ")
            && head.starts_with("Git ")
            && head.ends_with(" failed")
        {
            text = rest.trim_start();
        }
        if text == before {
            break;
        }
    }
    let mut cleaned = text.to_string();
    if let Some(first) = cleaned.get(..1) {
        cleaned = first.to_uppercase() + &cleaned[1..];
    }
    cleaned
}

/// Keeps a file's working copy in Local History before its changes are discarded.
pub type DiscardSnapshot = Arc<dyn Fn(&Path) -> Result<()> + Send + Sync>;

struct SnapshotHook(DiscardSnapshot);

impl gpui::Global for SnapshotHook {}

/// How discarding reaches Local History (`snapshotFilesBeforeDiscard`); without it discards keep
/// no copy.
pub fn set_discard_snapshot(cx: &mut gpui::App, snapshot: DiscardSnapshot) {
    cx.set_global(SnapshotHook(snapshot));
}


/// The branch being named in the Branches tab, and what it starts from (HEAD when `None`).
struct BranchDraft {
    base: Option<String>,
}

#[derive(Default)]
struct Refs {
    branches: Vec<String>,
    stashes: Vec<Stash>,
    commits: Vec<Commit>,
    worktrees: Vec<Worktree>,
    remotes: Vec<Remote>,
    tags: Vec<Tag>,
}

pub struct GitPanel {
    root: PathBuf,
    discover: Discover,
    focus_handle: FocusHandle,
    repo: RepoState,
    /// Bumped whenever the repository changes, so late results from the old one are dropped.
    generation: usize,
    tree: Option<WorkingTree>,
    groups: Groups,
    branches: Vec<String>,
    stashes: Vec<Stash>,
    commits: Vec<Commit>,
    worktrees: Vec<Worktree>,
    remotes: Vec<Remote>,
    tags: Vec<Tag>,
    has_more_commits: bool,
    /// The commit last opened from History: highlighted and expanded with its description,
    /// totals and actions (`activeCommitDiff`).
    open_commit: Option<String>,
    open_commit_totals: Option<CommitTotals>,
    reloading: bool,
    queued_reload: Option<Reload>,
    /// Which of the footer's lists is open in the secondary column, for its row to read as
    /// pressed. The column itself is the workbench's; this follows it.
    open_section: Option<GitSection>,
    /// Whether the filter field over Changes is showing. It lives behind a button: the field was
    /// a row of its own under a heading that is always open now, and a filter you are not using
    /// should not cost a row.
    filter_open: bool,
    /// The same, for the History panel's search field in the secondary column.
    history_filter_open: bool,
    /// Folder captions closed in the folder view of Changes and Staged (`staged:dir`, `changes:dir`).
    pub(crate) collapsed_folders: HashSet<String>,
    /// Whether the open commit's tab has been in front since it was opened, so leaving it collapses
    /// the commit (`activeCommitDiff`).
    commit_shown: bool,
    /// Where the Changes list has scrolled, for its sticky section headers.
    pub(crate) changes_scroll: gpui::ScrollHandle,
    busy_keys: HashSet<String>,
    remote_action: Option<RemoteOp>,
    committing: bool,
    generating: bool,
    initializing: bool,
    branch_draft: Option<BranchDraft>,
    draft: Option<DraftKind>,
    notice_epoch: usize,
    open_menu: Option<OpenMenu>,
    /// The commit composer's width at its last paint: the diff numbers hide under 230px, as the
    /// original's `@max-[230px]/composer:hidden`.
    pub(crate) composer_width: std::rc::Rc<std::cell::Cell<f32>>,
    pub(crate) settings: GitSettings,
    pending: Vec<(GitCommand, gpui::AnyWindowHandle)>,
    commit_input: Entity<TextArea>,
    filter_input: Entity<TextInput>,
    branch_name_input: Entity<TextInput>,
    draft_first: Entity<TextInput>,
    draft_second: Entity<TextInput>,
    /// The repositories found in the workspace folder (`discoverWorkspaceRepositories`).
    repositories: Vec<PathBuf>,
    history_filter_input: Entity<TextInput>,
    /// The panel's width at the last paint; the tabs and branch button adapt to it.
    width: std::rc::Rc<std::cell::Cell<Pixels>>,
    _subscriptions: Vec<Subscription>,
    _poll: Task<()>,
    _auto_fetch: Option<Task<()>>,
}

impl EventEmitter<GitPanelEvent> for GitPanel {}

impl Focusable for GitPanel {
    fn focus_handle(&self, _: &gpui::App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn bare_input(placeholder: &str, icon: Option<ui::IconName>, window: &mut Window, cx: &mut Context<GitPanel>) -> Entity<TextInput> {
    let placeholder = placeholder.to_string();
    cx.new(|cx| {
        // `StreamSearchField`: a clear button once something is typed.
        let input = TextInput::new(window, cx).placeholder(placeholder).appearance(InputAppearance::Bare).clearable();
        match icon {
            Some(icon) => input.leading_icon(icon),
            None => input,
        }
    })
}

impl GitPanel {
    pub fn new(root: PathBuf, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_discovery(root, Arc::new(repository::discover), window, cx)
    }

    /// A panel whose repository `discover` finds, such as a remote project's.
    pub fn with_discovery(root: PathBuf, discover: Discover, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let commit_input = cx.new(|cx| TextArea::new(cx).auto_size(1, 8).variant(TextAreaVariant::Ghost).placeholder("Commit message"));
        let filter_input = bare_input("Filter changes", Some(ui::IconName::Search), window, cx);
        let branch_name_input = cx.new(|cx| TextInput::new(window, cx).placeholder("feature/name"));
        let draft_first = cx.new(|cx| TextInput::new(window, cx));
        let draft_second = cx.new(|cx| TextInput::new(window, cx));
        let history_filter_input = bare_input("Search message, author, hash", Some(ui::IconName::Search), window, cx);

        let subscriptions = vec![
            cx.subscribe(&commit_input, |this, _, event: &TextAreaEvent, cx| match event {
                TextAreaEvent::Submit => this.commit(false, false, cx),
                TextAreaEvent::Changed => cx.notify(),
                TextAreaEvent::Cancelled => {}
            }),
            cx.subscribe(&filter_input, Self::on_filter_event),
            cx.subscribe(&branch_name_input, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Confirmed => this.create_branch_from_draft(cx),
                TextInputEvent::Cancelled => {
                    this.branch_draft = None;
                    cx.notify();
                }
                _ => {}
            }),
            cx.subscribe_in(&draft_first, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Confirmed => {
                    let focus = this.draft_second.focus_handle(cx);
                    window.focus(&focus, cx);
                }
                TextInputEvent::Cancelled => this.cancel_draft(cx),
                TextInputEvent::Changed(_) => cx.notify(),
                _ => {}
            }),
            cx.subscribe(&draft_second, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Confirmed => this.submit_draft(cx),
                TextInputEvent::Cancelled => this.cancel_draft(cx),
                _ => {}
            }),
            cx.subscribe(&history_filter_input, Self::on_filter_event),
            cx.observe_global::<settings::SettingsStore>(|this, cx| this.apply_settings(cx)),
            cx.observe_global::<workbench_api::OpenTabs>(|this, cx| this.follow_active_tab(cx)),
            cx.observe_window_activation(window, |this, window, cx| {
                if window.is_window_active() {
                    match this.repo {
                        RepoState::Ready(_) if this.settings.auto_refresh => this.reload(Reload::Full, cx),
                        RepoState::Ready(_) => {}
                        RepoState::Missing { .. } => this.discover(this.root.clone(), cx),
                        RepoState::Discovering => {}
                    }
                }
            }),
        ];

        let poll = cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(POLL_INTERVAL).await;
                let polled = this.update_in(cx, |this, window, cx| {
                    if window.is_window_active() && this.settings.auto_refresh {
                        this.reload(Reload::Status, cx);
                    }
                });
                if polled.is_err() {
                    break;
                }
            }
        });

        let settings = GitSettings::read(cx);
        let mut panel = Self {
            root: root.clone(),
            discover,
            focus_handle: cx.focus_handle(),
            repo: RepoState::Discovering,
            generation: 0,
            tree: None,
            groups: Groups::default(),
            branches: Vec::new(),
            stashes: Vec::new(),
            commits: Vec::new(),
            worktrees: Vec::new(),
            remotes: Vec::new(),
            tags: Vec::new(),
            has_more_commits: false,
            open_commit: None,
            open_commit_totals: None,
            reloading: false,
            queued_reload: None,
            open_section: None,
            filter_open: false,
            history_filter_open: false,
            collapsed_folders: HashSet::new(),
            commit_shown: false,
            changes_scroll: gpui::ScrollHandle::new(),
            busy_keys: HashSet::new(),
            remote_action: None,
            committing: false,
            generating: false,
            initializing: false,
            branch_draft: None,
            draft: None,
            notice_epoch: 0,
            open_menu: None,
            composer_width: std::rc::Rc::new(std::cell::Cell::new(0.)),
            settings,
            pending: Vec::new(),
            commit_input,
            filter_input,
            branch_name_input,
            draft_first,
            draft_second,
            repositories: Vec::new(),
            history_filter_input,
            width: Default::default(),
            _subscriptions: subscriptions,
            _poll: poll,
            _auto_fetch: None,
        };
        panel.restart_auto_fetch(cx);
        panel.scan_repositories(root.clone(), cx);
        panel.discover(root, cx);
        panel
    }

    fn apply_settings(&mut self, cx: &mut Context<Self>) {
        let settings = GitSettings::read(cx);
        if settings == self.settings {
            return;
        }
        let old = std::mem::replace(&mut self.settings, settings);
        if old.show_untracked != self.settings.show_untracked {
            self.regroup();
        }
        if old.auto_fetch_minutes != self.settings.auto_fetch_minutes {
            self.restart_auto_fetch(cx);
        }
        cx.notify();
    }

    fn regroup(&mut self) {
        if let Some(tree) = &self.tree {
            self.groups = group(visible_changes(change_files(&tree.files, &tree.stats), self.settings.show_untracked));
        }
    }

    /// Fetches in the background every `gitAutoFetchInterval` minutes; a fetch that worked reloads
    /// the refs.
    fn restart_auto_fetch(&mut self, cx: &mut Context<Self>) {
        let minutes = self.settings.auto_fetch_minutes;
        self._auto_fetch = (minutes > 0.).then(|| {
            cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(Duration::from_secs_f64(minutes * 60.)).await;
                    let Ok(repo) = this.update(cx, |this, _| this.repository()) else { break };
                    let Some(repo) = repo else { continue };
                    if cx.background_spawn(async move { repo.fetch(None) }).await.is_ok()
                        && this.update(cx, |this, cx| this.reload(Reload::Full, cx)).is_err()
                    {
                        break;
                    }
                }
            })
        });
    }

    /// Runs a `git.*` command, once the repository is known.
    pub fn run_command(&mut self, command: GitCommand, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.repo, RepoState::Discovering) || (self.tree.is_none() && matches!(self.repo, RepoState::Ready(_))) {
            self.pending.push((command, window.window_handle()));
            return;
        }
        match command {
            GitCommand::Refresh => self.refresh(cx),
            _ if self.repository().is_none() => self.report("No repository open", Tone::Error, None, cx),
            GitCommand::StageAll => {
                let files = self.groups.unstaged.clone();
                self.set_staged(files, true, cx);
            }
            GitCommand::UnstageAll => {
                let files = self.groups.staged.clone();
                self.set_staged(files, false, cx);
            }
            GitCommand::Commit => {
                if self.can_commit(cx) {
                    self.commit(false, false, cx);
                } else {
                    let focus = self.commit_input.focus_handle(cx);
                    window.focus(&focus, cx);
                }
            }
            GitCommand::Push => self.run_remote(RemoteOp::Push, cx),
            GitCommand::Pull => self.run_remote(RemoteOp::Pull, cx),
            GitCommand::Fetch => self.run_remote(RemoteOp::Fetch, cx),
            GitCommand::DiscardAll if self.settings.confirm_discard => {
                let position = window.mouse_position();
                self.confirm_discard_all(position, window, cx);
            }
            GitCommand::DiscardAll => self.discard_all(cx),
        }
    }

    fn run_pending(&mut self, cx: &mut Context<Self>) {
        let pending = std::mem::take(&mut self.pending);
        if pending.is_empty() {
            return;
        }
        cx.spawn(async move |this, cx| {
            for (command, handle) in pending {
                cx.update_window(handle, |_, window, cx| this.update(cx, |this, cx| this.run_command(command, window, cx))).ok();
            }
        })
        .detach();
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Opens one of the footer's lists by name, for headless snapshots. Other names are ignored.
    pub fn open_tab(&mut self, name: &str, cx: &mut Context<Self>) {
        let Some(section) = GitSection::from_key(name) else { return };
        self.open_section(Some(section), cx);
    }

    /// The tool's buttons at the end of the sidebar's top row.
    pub fn render_header_actions(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        use gpui::{IntoElement as _, ParentElement as _, Styled as _};
        let more = self.render_more_button(cx);
        gpui::div().flex().items_center().gap(ui::scale::px(2.)).child(self.render_header_buttons(cx)).child(more).into_any_element()
    }

    fn on_filter_event(&mut self, input: Entity<TextInput>, event: &TextInputEvent, cx: &mut Context<Self>) {
        match event {
            TextInputEvent::Changed(_) => cx.notify(),
            TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
            _ => {}
        }
    }

    fn repository(&self) -> Option<Arc<dyn GitRepository>> {
        match &self.repo {
            RepoState::Ready(repo) => Some(repo.clone()),
            _ => None,
        }
    }

    /// The selected repository's working-tree root, once its status has loaded (`None` while
    /// discovering or when the folder is not a repository). Observe the panel to follow changes.
    pub fn repo_root(&self) -> Option<PathBuf> {
        self.repository().map(|repo| repo.root().to_path_buf())
    }

    fn file_count(&self) -> usize {
        self.groups.staged.len() + self.groups.unstaged.len()
    }

    fn branch(&self) -> &str {
        self.tree.as_ref().map_or("", |tree| tree.branch.as_str())
    }

    fn ahead_behind(&self) -> (usize, usize) {
        self.tree.as_ref().map_or((0, 0), |tree| (tree.ahead, tree.behind))
    }

    // Loading.

    /// Finds the repository containing `path` and loads it.
    fn discover(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.generation += 1;
        self.open_commit = None;
        self.open_commit_totals = None;
        self.repo = RepoState::Discovering;
        self.reloading = false;
        self.queued_reload = None;
        if path.as_os_str().is_empty() {
            self.repo = RepoState::Missing { error: None };
            cx.notify();
            return;
        }
        let generation = self.generation;
        let discover = self.discover.clone();
        let task = cx.background_spawn(async move { discover(&path) });
        cx.spawn(async move |this, cx| {
            let repo = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                this.tree = None;
                this.groups = Groups::default();
                this.branches.clear();
                this.stashes.clear();
                this.commits.clear();
                this.worktrees.clear();
                this.remotes.clear();
                this.tags.clear();
                match repo {
                    Some(repo) => {
                        this.repo = RepoState::Ready(repo);
                        this.reload(Reload::Full, cx);
                    }
                    None => {
                        this.repo = RepoState::Missing { error: None };
                        this.run_pending(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn reload(&mut self, kind: Reload, cx: &mut Context<Self>) {
        let Some(repo) = self.repository() else { return };
        if self.reloading {
            self.queued_reload = self.queued_reload.max(Some(kind));
            return;
        }
        self.reloading = true;
        let generation = self.generation;
        let commit_count = self.commits.len().max(COMMIT_PAGE);
        let task = cx.background_spawn(async move {
            let tree = repo.status();
            let refs = (kind == Reload::Full && tree.is_ok()).then(|| Refs {
                branches: repo.branches().unwrap_or_default(),
                stashes: repo.stashes().unwrap_or_default(),
                commits: repo.log(0, commit_count).unwrap_or_default(),
                worktrees: repo.worktrees().unwrap_or_default(),
                remotes: repo.remotes().unwrap_or_default(),
                tags: repo.tags().unwrap_or_default(),
            });
            (tree, refs, commit_count)
        });
        cx.spawn(async move |this, cx| {
            let (tree, refs, commit_count) = task.await;
            this.update(cx, |this, cx| {
                if this.generation == generation {
                    this.apply_reload(tree, refs, commit_count, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn apply_reload(&mut self, tree: Result<WorkingTree>, refs: Option<Refs>, commit_count: usize, cx: &mut Context<Self>) {
        self.reloading = false;
        match tree {
            Ok(tree) => {
                let head_moved = self
                    .tree
                    .as_ref()
                    .is_some_and(|old| old.head != tree.head || old.branch != tree.branch);
                let groups = group(visible_changes(change_files(&tree.files, &tree.stats), self.settings.show_untracked));
                if groups != self.groups {
                    self.groups = groups;
                }
                self.tree = Some(tree);
                match refs {
                    Some(refs) => {
                        self.has_more_commits = refs.commits.len() >= commit_count;
                        self.branches = refs.branches;
                        self.stashes = refs.stashes;
                        self.commits = refs.commits;
                        self.worktrees = refs.worktrees;
                        self.remotes = refs.remotes;
                        self.tags = refs.tags;
                    }
                    None if head_moved => self.queued_reload = Some(Reload::Full),
                    None => {}
                }
            }
            Err(error) => {
                self.tree = None;
                self.repo = RepoState::Missing { error: Some(error.to_string().into()) };
            }
        }
        cx.notify();
        self.run_pending(cx);
        if let Some(kind) = self.queued_reload.take() {
            self.reload(kind, cx);
        }
    }

    fn load_more_commits(&mut self, cx: &mut Context<Self>) {
        let skip = self.commits.len();
        // Another repository may be shown by the time the page arrives: its history must not
        // take this one's commits.
        let generation = self.generation;
        self.run(
            move |repo| repo.log(skip, COMMIT_PAGE),
            move |this, result, cx| {
                if this.generation != generation || this.commits.len() != skip {
                    return;
                }
                if let Ok(mut commits) = result {
                    this.has_more_commits = commits.len() >= COMMIT_PAGE;
                    this.commits.append(&mut commits);
                    cx.notify();
                }
            },
            false,
            cx,
        );
    }

    /// Runs `work` against the repository off the UI thread, then `done` with its result. With
    /// `reload`, everything is read again afterwards.
    fn run<T: Send + 'static>(
        &mut self,
        work: impl FnOnce(&dyn GitRepository) -> Result<T> + Send + 'static,
        done: impl FnOnce(&mut Self, Result<T>, &mut Context<Self>) + 'static,
        reload: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(repo) = self.repository() else { return };
        let task = cx.background_spawn(async move { work(repo.as_ref()) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                done(this, result, cx);
                if reload {
                    this.reload(Reload::Full, cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Tells the user how an operation went, as the app's toasts (bottom right) where every
    /// message goes: `title: detail` splits into the toast's message and description, and an
    /// action becomes its button.
    fn report(&mut self, message: impl Into<SharedString>, tone: Tone, action: Option<NoticeAction>, cx: &mut Context<Self>) {
        let message: SharedString = message.into();
        let (title, detail) = match message.split_once(": ") {
            Some((title, detail)) => (title.to_string(), Some(SharedString::from(detail.to_string()))),
            None => (message.to_string(), None),
        };
        let kind = match tone {
            Tone::Success => notifications::NotificationKind::Success,
            Tone::Warning => notifications::NotificationKind::Warning,
            Tone::Error => notifications::NotificationKind::Error,
        };
        self.notice_epoch += 1;
        let id = SharedString::from(format!("git-panel-{}-{}", cx.entity_id(), self.notice_epoch));
        let sticky = action.is_some();
        let action = action.map(|action| {
            let (this, id) = (cx.weak_entity(), id.clone());
            notifications::NotificationAction::new(action.label(), move |_, cx| {
                notifications::dismiss_toast(cx, &id);
                this.update(cx, |panel, cx| panel.run_notice_action(action.clone(), cx)).ok();
            })
        });
        notifications::notify_with(
            cx,
            kind,
            notifications::NotificationCategory::Athas,
            title,
            detail,
            Some(id),
            notifications::ToastOptions { action, sticky, ..Default::default() },
        );
        cx.notify();
    }

    fn run_notice_action(&mut self, action: NoticeAction, cx: &mut Context<Self>) {
        match action {
            NoticeAction::StashAndSwitch(branch) => self.stash_and_switch(branch, cx),
            NoticeAction::DiscardWithoutCopy(files) => self.discard(files, false, cx),
            NoticeAction::PruneWorktrees => self.prune_worktrees(cx),
            NoticeAction::ForceRemoveWorktree(path) => self.remove_worktree_with(path, true, cx),
        }
    }

    fn report_error(&mut self, context: &str, error: anyhow::Error, cx: &mut Context<Self>) {
        self.report(format!("{context}: {}", clean_git_error(&error.to_string())), Tone::Error, None, cx);
    }

    // Operations.

    fn set_staged(&mut self, files: Vec<ChangeFile>, staged: bool, cx: &mut Context<Self>) {
        if files.is_empty() {
            return;
        }
        let keys: Vec<String> = files.iter().map(|file| file.key.clone()).collect();
        self.busy_keys.extend(keys.iter().cloned());
        let mut paths: Vec<String> = files.into_iter().map(|file| file.path).collect();
        paths.dedup();
        cx.notify();
        self.run(
            move |repo| repo.set_staged(&paths, staged),
            move |this, result, cx| {
                for key in &keys {
                    this.busy_keys.remove(key);
                }
                if let Err(error) = result {
                    this.report_error(if staged { "Failed to stage" } else { "Failed to unstage" }, error, cx);
                }
            },
            true,
            cx,
        );
    }

    /// The Local History hook, when discarded changes in this repository can be kept there (not
    /// for remote repositories).
    fn discard_snapshot(&self, cx: &gpui::App) -> Option<DiscardSnapshot> {
        let local = self.repo_root().is_some_and(|root| !root.to_string_lossy().contains("://"));
        cx.try_global::<SnapshotHook>().filter(|_| local).map(|hook| hook.0.clone())
    }

    /// Discards the files' changes, first keeping each working copy in Local History when
    /// `keep_copy` and a hook is set. When a copy cannot be kept nothing is discarded and the
    /// notice asks whether to go on without it.
    fn discard(&mut self, files: Vec<ChangeFile>, keep_copy: bool, cx: &mut Context<Self>) {
        let files: Vec<ChangeFile> = files.into_iter().filter(can_discard).collect();
        if files.is_empty() {
            return;
        }
        let snapshot = keep_copy.then(|| self.discard_snapshot(cx)).flatten();
        let targets = files.clone();
        self.run(
            move |repo| {
                if let Some(snapshot) = snapshot {
                    let failed: Vec<String> = targets
                        .iter()
                        .filter(|file| file.status != FileStatus::Deleted)
                        .filter(|file| snapshot(&repo.root().join(&file.path)).is_err())
                        .map(|file| file.path.clone())
                        .collect();
                    if !failed.is_empty() {
                        return Ok(Some(failed));
                    }
                }
                let paths: Vec<String> = targets.iter().map(|file| file.path.clone()).collect();
                repo.discard(&paths).map(|()| None)
            },
            move |this, result, cx| match result {
                Ok(Some(failed)) => {
                    let what = if let [path] = failed.as_slice() { path.clone() } else { plural(failed.len(), "file") };
                    this.report(
                        format!("Athas couldn't save a copy of {what} to Local History. Discard the changes anyway? They can't be restored."),
                        Tone::Warning,
                        Some(NoticeAction::DiscardWithoutCopy(files.clone())),
                        cx,
                    );
                }
                Ok(None) => {}
                Err(error) => this.report_error("Failed to discard changes", error, cx),
            },
            true,
            cx,
        );
    }

    /// Discards every change, staged ones too (`reset --hard`). Each changed file goes to Local
    /// History first, as a single discard does; if a copy fails nothing is discarded.
    fn discard_all(&mut self, cx: &mut Context<Self>) {
        let snapshot = self.discard_snapshot(cx);
        self.run(
            move |repo| {
                if let Some(snapshot) = snapshot {
                    let mut failed: Vec<String> = repo
                        .status()?
                        .files
                        .iter()
                        .filter(|file| file.status != FileStatus::Deleted)
                        .filter(|file| snapshot(&repo.root().join(&file.path)).is_err())
                        .map(|file| file.path.clone())
                        .collect();
                    failed.dedup();
                    if !failed.is_empty() {
                        return Ok(Some(failed));
                    }
                }
                repo.discard_all().map(|()| None)
            },
            |this, result, cx| match result {
                Ok(None) => this.report("Discarded all changes", Tone::Success, None, cx),
                Ok(Some(failed)) => {
                    let what = if let [path] = failed.as_slice() { path.clone() } else { plural(failed.len(), "file") };
                    this.report(format!("Nothing was discarded: Athas couldn't save a copy of {what} to Local History."), Tone::Warning, None, cx)
                }
                Err(error) => this.report_error("Failed to discard changes", error, cx),
            },
            true,
            cx,
        );
    }

    fn commit_message(&self, cx: &gpui::App) -> String {
        self.commit_input.read(cx).text().trim().to_string()
    }

    fn commit_scope(&self) -> CommitScope {
        CommitScope::new(self.groups.staged.len(), self.groups.unstaged.len())
    }

    fn can_commit(&self, cx: &gpui::App) -> bool {
        !self.committing && !self.commit_scope().is_empty() && !self.commit_message(cx).is_empty()
    }

    /// Commits the staged files, or every change when nothing is staged (`stage_all` forces that),
    /// then pushes with `and_push`.
    fn commit(&mut self, and_push: bool, stage_all: bool, cx: &mut Context<Self>) {
        let message = self.commit_message(cx);
        if self.committing || message.is_empty() || self.file_count() == 0 {
            return;
        }
        if !stage_all && !self.can_commit(cx) {
            return;
        }
        self.committing = true;
        cx.notify();
        let sign_off = self.settings.sign_off;
        let show_untracked = self.settings.show_untracked;
        self.run(
            move |repo| {
                // Decided from the index as it is now, not the panel's last poll: a hunk staged
                // in the diff view a moment ago means "commit what is staged", not "everything".
                let files = repo.status()?.files;
                let anything_staged = files.iter().any(|file| file.staged);
                if stage_all || !anything_staged {
                    let to_stage: Vec<String> = files
                        .iter()
                        .filter(|file| !file.staged && (show_untracked || file.status != FileStatus::Untracked))
                        .map(|file| file.path.clone())
                        .collect();
                    if !to_stage.is_empty() {
                        repo.set_staged(&to_stage, true)?;
                    }
                }
                repo.commit_signed(&message, sign_off)?;
                Ok(and_push.then(|| repo.remote(RemoteOp::Push, false)))
            },
            |this, result, cx| {
                this.committing = false;
                match result {
                    Ok(pushed) => {
                        this.commit_input.update(cx, |input, cx| input.set_text("", cx));
                        match pushed {
                            Some(Ok(())) => this.report("Pushed", Tone::Success, None, cx),
                            Some(Err(error)) => this.report_error("Push failed", error, cx),
                            None => {}
                        }
                    }
                    Err(error) => this.report_error("Commit failed", error, cx),
                }
            },
            true,
            cx,
        );
    }

    /// Asks the AI model for a commit subject describing the staged changes, with what was typed
    /// as a hint (`generateMessage`).
    fn generate_message(&mut self, cx: &mut Context<Self>) {
        if self.generating || self.groups.staged.is_empty() {
            return;
        }
        let Some(generator) = commit_message::generator(cx) else {
            self.report("AI is not available", Tone::Error, None, cx);
            return;
        };
        let Some(repo) = self.repository() else { return };
        let branch = self.branch().to_string();
        let staged: Vec<(String, FileStatus)> = self.groups.staged.iter().map(|file| (file.path.clone(), file.status)).collect();
        let draft = self.commit_message(cx);
        self.generating = true;
        cx.notify();
        let work = cx.background_spawn(async move {
            let root = repo.root().to_path_buf();
            let subjects: Vec<String> = repo.log(0, 24).map(|commits| commits.into_iter().map(|commit| commit.summary).collect()).unwrap_or_default();
            let files: Vec<commit_message::StagedFile> = staged
                .into_iter()
                .enumerate()
                .map(|(index, (path, status))| {
                    let diff = (index < 10).then(|| git_diff::git::load(&root, &DiffTarget::Staged { path: path.clone() }).ok()).flatten();
                    let file = diff.as_ref().and_then(|files| files.first());
                    let binary = file.is_some_and(|file| !matches!(file.content, git_diff::model::FileContent::Text { .. }));
                    let changed_lines = file.filter(|_| !binary).map(|file| {
                        file.hunks()
                            .iter()
                            .flat_map(|hunk| hunk.lines.iter())
                            .filter_map(|line| match line.kind {
                                git_diff::model::LineKind::Added => Some(format!("+{}", line.text)),
                                git_diff::model::LineKind::Removed => Some(format!("-{}", line.text)),
                                _ => None,
                            })
                            .collect()
                    });
                    commit_message::StagedFile { path, status: status_word(status), binary, changed_lines }
                })
                .collect();
            let repository = commit_message::repository_label(&root);
            let context = commit_message::build_context(&repository, &branch, &subjects, &files, &draft);
            CommitMessageRequest { repository, context, instruction: commit_message::TITLE_INSTRUCTION.to_string() }
        });
        cx.spawn(async move |this, cx| {
            let request = work.await;
            let task = cx.update(|cx| generator(request, cx));
            let result = task.await;
            this.update(cx, |this, cx| {
                this.generating = false;
                match result.map(|message| commit_message::normalize_title(&message)) {
                    Ok(message) if !message.is_empty() => this.commit_input.update(cx, |input, cx| input.set_text(message, cx)),
                    Ok(_) => {}
                    Err(error) => this.report(format!("{error:#}"), Tone::Error, None, cx),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn run_remote(&mut self, op: RemoteOp, cx: &mut Context<Self>) {
        if self.remote_action.is_some() {
            return;
        }
        self.remote_action = Some(op);
        cx.notify();
        let pull_rebase = self.settings.pull_rebase;
        self.run(
            move |repo| repo.remote(op, pull_rebase),
            move |this, result, cx| {
                this.remote_action = None;
                match result {
                    Ok(()) => this.report(op.past_tense(), Tone::Success, None, cx),
                    Err(error) => this.report_error(&format!("Failed to {}", op.verb()), error, cx),
                }
            },
            true,
            cx,
        );
    }

    fn checkout(&mut self, branch: String, cx: &mut Context<Self>) {
        if branch == self.branch() {
            return;
        }
        self.run(
            {
                let branch = branch.clone();
                move |repo| repo.checkout(&branch)
            },
            move |this, result, cx| match result {
                Ok(Checkout::Switched) => {}
                Ok(Checkout::Blocked(message)) => {
                    this.report(message, Tone::Warning, Some(NoticeAction::StashAndSwitch(branch)), cx)
                }
                Err(error) => this.report_error(&format!("Failed to switch to {branch}"), error, cx),
            },
            true,
            cx,
        );
    }

    fn stash_and_switch(&mut self, branch: String, cx: &mut Context<Self>) {
        self.run(
            {
                let branch = branch.clone();
                move |repo| {
                    repo.stash(Some(&format!("Switching to {branch}")), None)?;
                    repo.checkout(&branch)
                }
            },
            move |this, result, cx| match result {
                Ok(Checkout::Switched) => {
                    this.report(format!("Stashed changes and switched to {branch}"), Tone::Success, None, cx)
                }
                Ok(Checkout::Blocked(message)) => this.report(message, Tone::Error, None, cx),
                Err(error) => this.report_error(&format!("Failed to switch to {branch}"), error, cx),
            },
            true,
            cx,
        );
    }

    /// Opens the Branches tab with the name field, starting from `base` (HEAD when `None`).
    fn start_branch_draft(&mut self, base: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.branch_draft = Some(BranchDraft { base });
        self.branch_name_input.update(cx, |input, cx| input.set_text("", cx));
        let focus = self.branch_name_input.focus_handle(cx);
        window.focus(&focus, cx);
        cx.notify();
    }

    fn create_branch_from_draft(&mut self, cx: &mut Context<Self>) {
        let Some(draft) = &self.branch_draft else { return };
        let name = self.branch_name_input.read(cx).text().trim().to_string();
        if name.is_empty() {
            return;
        }
        let base = draft.base.clone();
        self.run(
            {
                let name = name.clone();
                move |repo| repo.create_branch(&name, base.as_deref())
            },
            move |this, result, cx| match result {
                Ok(()) => {
                    this.branch_draft = None;
                    this.report(format!("Switched to new branch {name}"), Tone::Success, None, cx);
                }
                Err(error) => this.report_error("Failed to create branch", error, cx),
            },
            true,
            cx,
        );
    }

    fn delete_branch(&mut self, branch: String, cx: &mut Context<Self>) {
        self.run(
            move |repo| repo.delete_branch(&branch),
            |this, result, cx| {
                if let Err(error) = result {
                    this.report_error("Failed to delete branch", error, cx);
                }
            },
            true,
            cx,
        );
    }

    fn stash(&mut self, message: String, paths: Option<Vec<String>>, cx: &mut Context<Self>) {
        self.run(
            move |repo| repo.stash(Some(&message), paths),
            |this, result, cx| {
                if let Err(error) = result {
                    this.report_error("Stash failed", error, cx);
                }
            },
            true,
            cx,
        );
    }

    fn stash_action(&mut self, action: StashAction, index: usize, cx: &mut Context<Self>) {
        self.run(
            move |repo| repo.stash_action(action, index),
            move |this, result, cx| {
                if let Err(error) = result {
                    let verb = match action {
                        StashAction::Apply => "apply",
                        StashAction::Pop => "pop",
                        StashAction::Drop => "drop",
                    };
                    this.report_error(&format!("Stash {verb} failed"), error, cx);
                }
            },
            true,
            cx,
        );
    }

    fn initialize(&mut self, cx: &mut Context<Self>) {
        if self.initializing {
            return;
        }
        self.initializing = true;
        cx.notify();
        let root = self.root.clone();
        let branch = Some(self.settings.default_branch.clone());
        let task = cx.background_spawn(async move { repository::init(&root, branch) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.initializing = false;
                match result {
                    Ok(()) => this.discover(this.root.clone(), cx),
                    Err(error) => {
                        this.repo = RepoState::Missing { error: Some(format!("Failed to initialize: {error}").into()) };
                        cx.notify();
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    /// Finds the repositories in the workspace folder, and the one containing it.
    fn scan_repositories(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            if !root.is_dir() {
                return;
            }
            let discover = self.discover.clone();
            let task = cx.background_spawn(async move {
                let mut found = model::scan_repositories(&root);
                if let Some(containing) = discover(&root).map(|repo| repo.root().to_path_buf())
                    && !found.contains(&containing)
                {
                    found.insert(0, containing);
                }
                found
            });
            cx.spawn(async move |this, cx| {
                let found = task.await;
                this.update(cx, |this, cx| {
                    this.repositories = found;
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        #[cfg(target_family = "wasm")]
        let _ = (root, cx);
    }

    /// The workspace's repositories, the one shown among them.
    pub(crate) fn repository_paths(&self) -> Vec<PathBuf> {
        let mut paths = self.repositories.clone();
        if let Some(current) = self.repo_root()
            && !paths.contains(&current)
        {
            paths.insert(0, current);
        }
        paths
    }

    /// Shows another repository of the workspace (`selectRepository`).
    pub(crate) fn switch_repository(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.discover(path, cx);
    }

    /// Picks a folder and shows the repository that contains it.
    fn select_repository(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Select Repository".into()),
        });
        let discover = self.discover.clone();
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            let found = cx.background_spawn({
                let path = path.clone();
                async move { discover(&path).is_some() }
            });
            let found = found.await;
            this.update(cx, |this, cx| {
                if found {
                    this.discover(path, cx);
                } else {
                    this.report("Selected folder is not inside a Git repository.", Tone::Error, None, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn open_file(&mut self, file: &ChangeFile, cx: &mut Context<Self>) {
        if file.path.ends_with('/') {
            return;
        }
        if let Some(root) = self.repo_root() {
            cx.emit(GitPanelEvent::OpenFile(root.join(&file.path)));
        }
    }

    /// Opens what a change row shows: its diff when `openDiffOnClick` is on (the default), else
    /// the file.
    fn open_change(&mut self, file: &ChangeFile, cx: &mut Context<Self>) {
        let open_diff = !cx.has_global::<settings::SettingsStore>() || settings::get(cx).open_diff_on_click;
        if open_diff {
            self.open_diff(file, cx);
        } else if file.status != repository::FileStatus::Deleted {
            self.open_file(file, cx);
        }
    }

    /// A change's diff; an untracked file has none, and a change whose diff has no lines (a mode
    /// change, a pure rename) shows nothing, so both open the file (`viewFileDiff`).
    fn open_diff(&mut self, file: &ChangeFile, cx: &mut Context<Self>) {
        if file.path.ends_with('/') {
            return;
        }
        if file.status == FileStatus::Untracked && !file.staged {
            self.open_file(file, cx);
            return;
        }
        let path = file.path.clone();
        let target = if file.staged { DiffTarget::Staged { path } } else { DiffTarget::Working { path } };
        #[cfg(not(target_family = "wasm"))]
        if let Some(root) = self.repo_root()
            && file.status != FileStatus::Deleted
        {
            let file = file.clone();
            let check = target.clone();
            let task = cx.background_spawn(async move { git_diff::git::load(&root, &check).map(|files| model::diff_is_empty(&files)) });
            cx.spawn(async move |this, cx| {
                let empty = task.await.unwrap_or(false);
                this.update(cx, |this, cx| {
                    if empty {
                        this.open_file(&file, cx);
                    } else {
                        git_diff::open_diff(cx, this.repo_root().as_deref(), &target);
                    }
                })
                .ok();
            })
            .detach();
            return;
        }
        git_diff::open_diff(cx, self.repo_root().as_deref(), &target);
    }

    /// The diff tab a changed file opens, to drag into a pane or the agent composer.
    pub(crate) fn diff_drag(&self, file: &ChangeFile) -> Option<ui::DraggedResource> {
        if file.path.ends_with('/') {
            return None;
        }
        let path = file.path.clone();
        let target = if file.staged { DiffTarget::Staged { path } } else { DiffTarget::Working { path } };
        let repo = self.repo_root();
        Some(ui::DraggedResource::new(git_diff::DIFF_KIND, git_diff::diff_id(repo.as_deref(), &target), target.title(), file.name.clone(), ui::IconName::GitDiff))
    }

    pub(crate) fn commit_drag(&self, commit: &Commit) -> ui::DraggedResource {
        let title = format!("{} {}", model::short_hash(&commit.hash), commit.summary);
        let repo = self.repo_root();
        ui::DraggedResource::new(git_diff::COMMIT_KIND, git_diff::commit_id(repo.as_deref(), &commit.hash), title.clone(), title, ui::IconName::GitCommit)
    }

    fn open_blame(&mut self, file: &ChangeFile, cx: &mut Context<Self>) {
        git_diff::open_blame(cx, self.repo_root().as_deref(), &file.path);
    }

    fn open_commit(&mut self, commit: &Commit, cx: &mut Context<Self>) {
        let title = format!("{} {}", model::short_hash(&commit.hash), commit.summary);
        git_diff::open_commit(cx, self.repo_root().as_deref(), &commit.hash, Some(&title));
        self.select_commit(commit.hash.clone(), cx);
    }

    /// The commit whose tab is in front: it is highlighted and expanded in History, and collapses
    /// once another tab comes to the front or its tab closes, as the original's
    /// `activeCommitDiff` follows the active buffer.
    fn follow_active_tab(&mut self, cx: &mut Context<Self>) {
        let Some(repo) = self.repo_root() else { return };
        let prefix = git_diff::commit_id(Some(&repo), "");
        let active = workbench_api::active_tab(cx)
            .filter(|tab| tab.kind.as_deref() == Some(git_diff::COMMIT_KIND))
            .and_then(|tab| tab.id)
            .and_then(|id| id.strip_prefix(&prefix).map(str::to_string));
        match active {
            Some(hash) if self.open_commit.as_deref() == Some(hash.as_str()) => self.commit_shown = true,
            Some(hash) => {
                self.select_commit(hash, cx);
                self.commit_shown = true;
            }
            None if self.commit_shown && self.open_commit.is_some() => {
                self.open_commit = None;
                self.open_commit_totals = None;
                self.commit_shown = false;
                cx.notify();
            }
            None => {}
        }
    }

    fn select_commit(&mut self, hash: String, cx: &mut Context<Self>) {
        if self.open_commit.as_deref() != Some(hash.as_str()) {
            self.open_commit = Some(hash.clone());
            self.open_commit_totals = None;
            self.commit_shown = false;
            self.run(
                {
                    let hash = hash.clone();
                    move |repo| repo.commit_totals(&hash)
                },
                move |this, result, cx| {
                    if this.open_commit.as_deref() == Some(hash.as_str()) {
                        this.open_commit_totals = result.ok();
                        cx.notify();
                    }
                },
                false,
                cx,
            );
        }
        cx.notify();
    }

    fn open_stash(&mut self, index: usize, cx: &mut Context<Self>) {
        git_diff::open_diff(cx, self.repo_root().as_deref(), &DiffTarget::Stash { index });
    }

    /// Every staged, unstaged or tracked change in one diff tab (`viewWorkingTreeDiff`).
    fn view_all(&mut self, scope: Scope, cx: &mut Context<Self>) {
        let has_entries = match scope {
            Scope::All => !self.groups.staged.is_empty() || self.groups.unstaged.iter().any(|file| file.status != FileStatus::Untracked),
            Scope::Staged => !self.groups.staged.is_empty(),
            Scope::Unstaged => self.groups.unstaged.iter().any(|file| file.status != FileStatus::Untracked),
        };
        if !has_entries {
            self.report(format!("No {} with diffs.", scope.empty_label()), Tone::Warning, None, cx);
            return;
        }
        git_diff::open_diff(cx, self.repo_root().as_deref(), &DiffTarget::WorkingTree { scope });
    }

    /// What the current branch changed since `base` (`viewBranchDiff`).
    fn view_branch_diff(&mut self, base: String, cx: &mut Context<Self>) {
        let target = if self.branch().is_empty() { "HEAD".to_string() } else { self.branch().to_string() };
        if base.is_empty() || base == target {
            return;
        }
        git_diff::open_diff(cx, self.repo_root().as_deref(), &DiffTarget::Compare { base, target });
    }

    /// The working tree compared with a commit: the commit's changes (`picker === "commit"`).
    fn show_commit_picker(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let mut entries = vec![MenuEntry::Label(format!("Compare working tree with commit… ({})", plural(self.commits.len(), "commit")).into())];
        if self.commits.is_empty() {
            entries.push(MenuItem::new("No matching commits").disabled(true).into());
        }
        for commit in &self.commits {
            let open = commit.clone();
            entries.push(
                self.item(commit.summary.clone(), cx, move |this, _, cx| this.open_commit(&open, cx))
                    .icon(ui::IconName::History)
                    .trailing_text(model::short_hash(&commit.hash).to_string())
                    .keywords(format!("{} {}", commit.hash, commit.author))
                    .into(),
            );
        }
        self.show_menu("git-compare-commit", entries, position, Anchor::TopRight, window, cx);
        self.make_searchable("git-compare-commit", "Compare working tree with commit...", "No matching commits", cx);
    }

    /// The branches to compare the current one with (`showBranchPicker`).
    fn show_branch_picker(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let current = self.branch().to_string();
        let others: Vec<String> = self.branches.iter().filter(|branch| **branch != current).cloned().collect();
        let mut entries = vec![MenuEntry::Label(format!("Compare current branch with… ({})", plural(others.len(), "branch")).into())];
        if others.is_empty() {
            entries.push(MenuItem::new("No other branches").disabled(true).into());
        }
        for branch in others {
            let base = branch.clone();
            entries.push(
                self.item(branch, cx, move |this, _, cx| this.view_branch_diff(base.clone(), cx))
                    .icon(ui::IconName::GitBranch)
                    .trailing_text(format!("compare with {current}"))
                    .into(),
            );
        }
        self.show_menu("git-compare-branch", entries, position, Anchor::TopRight, window, cx);
        self.make_searchable("git-compare-branch", "Compare current branch with...", "No matching branches", cx);
    }

    /// The branch menu: switch, start a new one or delete one, then the worktrees and repositories.
    pub(crate) fn show_branches_menu(&mut self, position: Point<Pixels>, anchor: Anchor, window: &mut Window, cx: &mut Context<Self>) {
        let current = self.branch().to_string();
        let mut entries: Vec<MenuEntry> = vec![self.item("New branch…", cx, |this, window, cx| this.start_branch_draft(None, window, cx)).icon(ui::IconName::Plus).into(), MenuEntry::Separator];
        for branch in &self.branches {
            let name = branch.clone();
            let is_current = *branch == current;
            entries.push(
                self.item(branch.clone(), cx, move |this, _, cx| this.checkout(name.clone(), cx))
                    .icon(ui::IconName::GitBranch)
                    .checked(is_current)
                    .disabled(is_current)
                    .into(),
            );
        }
        let others: Vec<String> = self.branches.iter().filter(|branch| **branch != current).cloned().collect();
        if !others.is_empty() {
            let doomed: Vec<MenuEntry> = others
                .into_iter()
                .map(|branch| {
                    let name = branch.clone();
                    self.item(branch, cx, move |this, window, cx| {
                        let position = window.mouse_position();
                        this.confirm_delete_branch(name.clone(), position, window, cx)
                    })
                    .icon(ui::IconName::Trash)
                    .into()
                })
                .collect();
            entries.push(MenuEntry::Separator);
            entries.push(MenuItem::new("Delete branch").icon(ui::IconName::Trash).submenu(doomed).into());
        }
        entries.push(MenuEntry::Separator);
        entries.push(MenuEntry::Label("Worktrees".into()));
        let main = self.worktrees.first().map(|worktree| worktree.path.clone());
        for worktree in &self.worktrees {
            let name = worktree.path.trim_end_matches('/').rsplit('/').next().unwrap_or(&worktree.path).to_string();
            let branch = worktree.branch.clone().unwrap_or_else(|| if worktree.is_detached { "detached".into() } else { "no branch".into() });
            let removable = !worktree.is_current && main.as_ref() != Some(&worktree.path) && !worktree.is_bare;
            entries.push(
                MenuItem::new(name)
                    .icon(if worktree.prunable { ui::IconName::Warning } else { ui::IconName::Nodes })
                    .trailing_text(branch)
                    .checked(worktree.is_current)
                    .submenu(self.worktree_entries(worktree.path.clone(), worktree.prunable, removable, cx))
                    .into(),
            );
        }
        entries.push(self.item("New worktree…", cx, |this, window, cx| this.start_draft(DraftKind::Worktree, window, cx)).icon(ui::IconName::Plus).into());
        let repositories = self.repository_paths();
        if repositories.len() > 1 {
            entries.push(MenuEntry::Separator);
            entries.push(MenuEntry::Label("Repositories".into()));
            for path in repositories {
                let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                let is_current = self.repo_root().as_deref() == Some(path.as_path());
                entries.push(
                    self.item(name, cx, move |this, _, cx| this.switch_repository(path.clone(), cx))
                        .icon(ui::IconName::FolderOpen)
                        .checked(is_current)
                        .disabled(is_current)
                        .into(),
                );
            }
        }
        self.show_menu("git-branches", entries, position, anchor, window, cx);
        self.make_searchable("git-branches", "Switch branch...", "No matching branches", cx);
    }

    fn worktree_entries(&self, path: String, prunable: bool, removable: bool, cx: &Context<Self>) -> Vec<MenuEntry> {
        let mut entries: Vec<MenuEntry> = Vec::new();
        if !prunable {
            let (open, window_path) = (path.clone(), path.clone());
            entries.push(self.item("Open", cx, move |_, _, cx| workbench_api::open_project(cx, open.clone())).icon(ui::IconName::FolderOpen).into());
            entries.push(self.item("Open in New Window", cx, move |_, _, cx| workbench_api::open_project_in_new_window(cx, window_path.clone())).icon(ui::IconName::OpenExternal).into());
            entries.push(MenuEntry::Separator);
        }
        let copy = path.clone();
        entries.push(self.item("Copy Path", cx, move |this, _, cx| this.copy(copy.clone(), cx)).icon(ui::IconName::Copy).into());
        if prunable {
            entries.push(MenuEntry::Separator);
            entries.push(self.item("Prune Stale Worktrees", cx, |this, _, cx| this.prune_worktrees(cx)).icon(ui::IconName::Broom).into());
        } else if removable {
            entries.push(MenuEntry::Separator);
            entries.push(
                self.item("Remove Worktree…", cx, move |this, window, cx| {
                    let position = window.mouse_position();
                    this.confirm_remove_worktree(path.clone(), position, window, cx)
                })
                .icon(ui::IconName::Trash)
                .destructive()
                .into(),
            );
        }
        entries
    }

    /// The Changes toolbar's Compare menu.
    fn compare_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let has_unstaged = !self.groups.unstaged.is_empty();
        let has_staged = !self.groups.staged.is_empty();
        vec![
            self.item("Unstaged changes", cx, |this, _, cx| this.view_all(Scope::Unstaged, cx)).disabled(!has_unstaged).into(),
            self.item("Staged changes", cx, |this, _, cx| this.view_all(Scope::Staged, cx)).disabled(!has_staged).into(),
            MenuEntry::Separator,
            self.item("Against a commit…", cx, |this, window, cx| {
                let position = window.mouse_position();
                this.open_menu = None;
                this.show_commit_picker(position, window, cx)
            })
            .into(),
            self.item("Against a branch…", cx, |this, window, cx| {
                let position = window.mouse_position();
                this.open_menu = None;
                this.show_branch_picker(position, window, cx)
            })
            .into(),
        ]
    }

    /// Whether a sidebar view or repository item shows (`hiddenGitSidebarItems`).
    pub(crate) fn is_visible(&self, item: &str) -> bool {
        !self.settings.hidden_items.iter().any(|hidden| hidden == item)
    }

    fn set_item_visible(&mut self, item: &'static str, visible: bool, cx: &mut Context<Self>) {
        let mut hidden = self.settings.hidden_items.clone();
        hidden.retain(|hidden| hidden != item);
        if !visible {
            hidden.push(item.to_string());
        }
        self.settings.hidden_items = hidden.clone();
        if cx.has_global::<settings::SettingsStore>() {
            settings::update(cx, |settings| settings.hidden_git_sidebar_items = hidden);
        }
        cx.notify();
    }

    fn checkout_tag(&mut self, name: String, cx: &mut Context<Self>) {
        self.run(
            move |repo| repo.checkout_tag(&name),
            |this, result, cx| match result {
                Ok(Checkout::Switched) => {}
                Ok(Checkout::Blocked(message)) => this.report(message, Tone::Error, None, cx),
                Err(error) => this.report_error("Checkout failed", error, cx),
            },
            true,
            cx,
        );
    }

    fn delete_remote_tag(&mut self, name: String, remote: String, cx: &mut Context<Self>) {
        let done = format!("Deleted {name} from {remote}");
        self.run_reported(move |repo| repo.delete_remote_tag(&name, &remote), done, "Failed to delete remote tag", cx);
    }

    /// What changed from `base` to the tag.
    fn compare_tag(&mut self, base: String, tag: String, cx: &mut Context<Self>) {
        git_diff::open_diff(cx, self.repo_root().as_deref(), &DiffTarget::Compare { base, target: tag });
    }

    // Worktrees, remotes and tags.

    fn start_draft(&mut self, kind: DraftKind, window: &mut Window, cx: &mut Context<Self>) {
        self.draft = Some(kind);
        let (first, second) = kind.placeholders();
        let first_text = match kind {
            // Next to the repository, named after it, as Athas suggests.
            DraftKind::Worktree => self
                .repo_root()
                .and_then(|root| Some(format!("{}-", root.parent()?.join(root.file_name()?).to_string_lossy())))
                .unwrap_or_default(),
            DraftKind::Remote if self.remotes.is_empty() => "origin".into(),
            _ => String::new(),
        };
        self.draft_first.update(cx, |input, cx| {
            input.set_placeholder(first, cx);
            input.set_text(first_text, cx);
        });
        self.draft_second.update(cx, |input, cx| {
            input.set_placeholder(second, cx);
            input.set_text("", cx);
        });
        let focus = self.draft_first.focus_handle(cx);
        window.focus(&focus, cx);
        cx.notify();
    }

    fn cancel_draft(&mut self, cx: &mut Context<Self>) {
        self.draft = None;
        cx.notify();
    }

    fn submit_draft(&mut self, cx: &mut Context<Self>) {
        let Some(kind) = self.draft else { return };
        let first = self.draft_first.read(cx).text().trim().to_string();
        let second = self.draft_second.read(cx).text().trim().to_string();
        if first.is_empty() || (kind == DraftKind::Remote && second.is_empty()) {
            return;
        }
        let second = (!second.is_empty()).then_some(second);
        self.run(
            {
                let first = first.clone();
                move |repo| match kind {
                    DraftKind::Worktree => repo.add_worktree(&first, second.as_deref()),
                    DraftKind::Remote => repo.add_remote(&first, second.as_deref().unwrap_or_default()),
                    DraftKind::Tag => repo.create_tag(&first, second.as_deref()),
                }
            },
            move |this, result, cx| match result {
                Ok(()) => {
                    this.draft = None;
                    let done = match kind {
                        DraftKind::Worktree => format!("Created worktree {first}"),
                        DraftKind::Remote => format!("Added remote {first}"),
                        DraftKind::Tag => format!("Created tag {first}"),
                    };
                    this.report(done, Tone::Success, None, cx);
                }
                Err(error) => {
                    let what = match kind {
                        DraftKind::Worktree => "Failed to create worktree",
                        DraftKind::Remote => "Failed to add remote",
                        DraftKind::Tag => "Failed to create tag",
                    };
                    this.report_error(what, error, cx);
                }
            },
            true,
            cx,
        );
    }

    /// Runs a ref operation and reports it: `done` on success, `failed: error` otherwise.
    fn run_reported(
        &mut self,
        work: impl FnOnce(&dyn GitRepository) -> Result<()> + Send + 'static,
        done: String,
        failed: &'static str,
        cx: &mut Context<Self>,
    ) {
        self.run(
            work,
            move |this, result, cx| match result {
                Ok(()) => this.report(done, Tone::Success, None, cx),
                Err(error) => this.report_error(failed, error, cx),
            },
            true,
            cx,
        );
    }

    fn prune_worktrees(&mut self, cx: &mut Context<Self>) {
        self.run_reported(|repo| repo.prune_worktrees(), "Pruned stale worktrees".into(), "Couldn't prune worktrees", cx);
    }

    fn remove_worktree(&mut self, path: String, cx: &mut Context<Self>) {
        self.remove_worktree_with(path, false, cx);
    }

    /// Removes a worktree; when git refuses, says why and offers the fix (Prune, Force Remove).
    fn remove_worktree_with(&mut self, path: String, force: bool, cx: &mut Context<Self>) {
        let done = format!("Removed worktree {path}");
        let target = path.clone();
        self.run(
            move |repo| repo.remove_worktree(&path, force),
            move |this, result, cx| match result {
                Ok(()) => this.report(done, Tone::Success, None, cx),
                Err(error) => {
                    let (message, action) = worktree_removal_problem(&error.to_string(), &target, force);
                    this.report(message, Tone::Error, action, cx);
                }
            },
            true,
            cx,
        );
    }

    fn remove_remote(&mut self, name: String, cx: &mut Context<Self>) {
        let done = format!("Removed remote {name}");
        self.run_reported(move |repo| repo.remove_remote(&name), done, "Failed to remove remote", cx);
    }

    fn fetch_remote(&mut self, name: Option<String>, cx: &mut Context<Self>) {
        if self.remote_action.is_some() {
            return;
        }
        self.remote_action = Some(RemoteOp::Fetch);
        cx.notify();
        let done = name.as_ref().map_or_else(|| "Fetched".to_string(), |name| format!("Fetched {name}"));
        self.run(
            move |repo| repo.fetch(name.as_deref()),
            move |this, result, cx| {
                this.remote_action = None;
                match result {
                    Ok(()) => this.report(done, Tone::Success, None, cx),
                    Err(error) => this.report_error("Fetch failed", error, cx),
                }
            },
            true,
            cx,
        );
    }

    fn delete_tag(&mut self, name: String, cx: &mut Context<Self>) {
        let done = format!("Deleted tag {name}");
        self.run_reported(move |repo| repo.delete_tag(&name), done, "Failed to delete tag", cx);
    }

    fn push_tag(&mut self, name: String, remote: String, cx: &mut Context<Self>) {
        let done = format!("Pushed {name} to {remote}");
        self.run_reported(move |repo| repo.push_tag(&name, &remote), done, "Failed to push tag", cx);
    }

    /// The remote tags are pushed to: `origin`, else the first.
    fn tag_remote(&self) -> Option<String> {
        self.remotes.iter().find(|remote| remote.name == "origin").or(self.remotes.first()).map(|remote| remote.name.clone())
    }

    /// Scrolls the Changes list down by `distance` (headless snapshots of the sticky headers).
    pub fn scroll_changes_by(&mut self, distance: Pixels, cx: &mut Context<Self>) {
        let offset = self.changes_scroll.offset();
        self.changes_scroll.set_offset(gpui::point(offset.x, offset.y - distance));
        cx.notify();
    }

    /// Whether the panel was given a folder: without one it shows "No repository selected".
    pub(crate) fn has_root(&self) -> bool {
        !self.root.as_os_str().is_empty()
    }


    /// The repository is checked out in a linked worktree, not its main one (`isLinkedWorktree`).
    pub(crate) fn is_linked_worktree(&self) -> bool {
        self.worktrees.iter().position(|worktree| worktree.is_current).is_some_and(|index| index > 0)
    }

    pub(crate) fn copy(&self, text: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(text));
    }

    /// Opens or closes a folder caption in the folder view.
    pub(crate) fn toggle_folder(&mut self, key: String, cx: &mut Context<Self>) {
        if !self.collapsed_folders.remove(&key) {
            self.collapsed_folders.insert(key);
        }
        cx.notify();
    }

    /// A footer row: opens its list in the secondary column, or closes the column when it is the
    /// one already open.
    pub(crate) fn toggle_git_section(&mut self, section: GitSection, cx: &mut Context<Self>) {
        let next = (self.open_section != Some(section)).then_some(section);
        self.open_section(next, cx);
    }

    /// Follows the secondary column: the workbench calls this when the column closes or shows
    /// something else, so a footer row never reads as pressed over a column that moved on.
    pub fn open_section(&mut self, section: Option<GitSection>, cx: &mut Context<Self>) {
        if self.open_section == section {
            return;
        }
        self.open_section = section;
        cx.emit(GitPanelEvent::OpenSection(section));
        cx.notify();
    }

    /// Whether the History panel's search field is showing.
    pub(crate) fn history_filter_is_open(&self, cx: &gpui::App) -> bool {
        self.history_filter_open || !self.history_filter_input.read(cx).text().trim().is_empty()
    }

    /// The History panel's search button, the twin of the Changes filter.
    pub(crate) fn toggle_history_filter(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.history_filter_open = !self.history_filter_is_open(cx);
        match self.history_filter_open {
            true => {
                let focus = self.history_filter_input.focus_handle(cx);
                window.focus(&focus, cx);
            }
            false => self.history_filter_input.update(cx, |input, cx| input.set_text(String::new(), cx)),
        }
        cx.notify();
    }

    /// Whether the filter field over Changes is showing. A filter still in force keeps it open
    /// whatever the button says, so a narrowed list never looks like the whole list.
    pub(crate) fn filter_is_open(&self, cx: &gpui::App) -> bool {
        self.filter_open || !self.filter_input.read(cx).text().trim().is_empty()
    }

    /// The filter button: shows the field and puts the caret in it, or hides it and clears it.
    pub(crate) fn toggle_filter(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.filter_open = !self.filter_is_open(cx);
        match self.filter_open {
            true => {
                let focus = self.filter_input.focus_handle(cx);
                window.focus(&focus, cx);
            }
            false => self.filter_input.update(cx, |input, cx| input.set_text(String::new(), cx)),
        }
        cx.notify();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        match self.repo {
            RepoState::Ready(_) => self.reload(Reload::Full, cx),
            _ => self.discover(self.root.clone(), cx),
        }
    }

    // Menus.

    fn show_menu(
        &mut self,
        key: &str,
        entries: Vec<MenuEntry>,
        position: Point<Pixels>,
        anchor: Anchor,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.menu_is_open(key) {
            if let Some(menu) = self.open_menu.take() {
                menu.close(window, cx);
            }
            cx.notify();
            return;
        }
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, position, anchor, window, cx, |this: &mut Self, _| {
            this.open_menu = None
        }));
        cx.notify();
    }

    /// A filter field over the open menu's rows (`GitCommandSurface`).
    fn make_searchable(&mut self, key: &str, placeholder: &str, empty: &str, cx: &mut Context<Self>) {
        if self.menu_is_open(key) && let Some(menu) = self.open_menu.take() {
            self.open_menu = Some(menu.searchable(placeholder.to_string(), empty.to_string(), cx));
        }
    }

    fn menu_is_open(&self, key: &str) -> bool {
        self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key)
    }

    /// A menu item that calls back into the panel.
    fn item(
        &self,
        label: impl Into<SharedString>,
        cx: &Context<Self>,
        action: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> MenuItem {
        let this = cx.entity().downgrade();
        MenuItem::new(label).on_select(move |window, cx| {
            this.update(cx, |this, cx| action(this, window, cx)).ok();
        })
    }

    /// Asks before something that cannot be undone, as a menu with the question and one action.
    fn confirm(
        &mut self,
        key: &str,
        question: impl Into<SharedString>,
        label: &str,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
        action: impl Fn(&mut Self, &mut Context<Self>) + 'static,
    ) {
        let entries = vec![
            MenuEntry::Label(question.into()),
            self.item(label.to_string(), cx, move |this, _, cx| action(this, cx))
                .icon(ui::IconName::Trash)
                .destructive()
                .into(),
        ];
        self.show_menu(key, entries, position, Anchor::TopRight, window, cx);
    }

    fn confirm_discard(&mut self, files: Vec<ChangeFile>, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let files: Vec<ChangeFile> = files.into_iter().filter(can_discard).collect();
        let label = match files.as_slice() {
            [] => return,
            [file] => file.name.clone(),
            files => plural(files.len(), "file"),
        };
        let question = if self.discard_snapshot(cx).is_some() {
            format!("Discard changes in {label}? The current version is saved to Local History first. To get it back, run File: Show Local History on the file and restore the “discard” entry.")
        } else {
            format!("Discard changes in {label}? This can't be undone.")
        };
        self.confirm("discard", question, "Discard", position, window, cx, move |this, cx| this.discard(files.clone(), true, cx));
    }

    fn confirm_discard_all(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        self.confirm(
            "discard-all",
            // `reset --hard`: staged changes go too.
            "Discard all changes, staged and unstaged? Local History keeps a copy of each file.",
            "Discard",
            position,
            window,
            cx,
            |this, cx| this.discard_all(cx),
        );
    }

    fn confirm_delete_branch(&mut self, branch: String, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        self.confirm(
            "delete-branch",
            format!("Delete branch \"{branch}\"?"),
            "Delete",
            position,
            window,
            cx,
            move |this, cx| this.delete_branch(branch.clone(), cx),
        );
    }

    fn confirm_remove_worktree(&mut self, path: String, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        self.confirm(
            "remove-worktree",
            format!("Remove the worktree at {path}? Its folder is deleted."),
            "Remove",
            position,
            window,
            cx,
            move |this, cx| this.remove_worktree(path.clone(), cx),
        );
    }

    fn confirm_remove_remote(&mut self, name: String, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        self.confirm(
            "remove-remote",
            format!("Remove remote \"{name}\"?"),
            "Remove",
            position,
            window,
            cx,
            move |this, cx| this.remove_remote(name.clone(), cx),
        );
    }

    fn file_menu(&self, file: &ChangeFile, cx: &Context<Self>) -> Vec<MenuEntry> {
        let mut entries: Vec<MenuEntry> = Vec::new();
        let diff = file.clone();
        entries.push(self.item("Open Changes", cx, move |this, _, cx| this.open_diff(&diff, cx)).icon(ui::IconName::GitDiff).into());
        if file.status != repository::FileStatus::Deleted {
            let open = file.clone();
            entries.push(self.item("Open File", cx, move |this, _, cx| this.open_file(&open, cx)).icon(ui::IconName::FileText).into());
        }
        if matches!(file.status, repository::FileStatus::Modified | repository::FileStatus::Renamed) {
            let blame = file.clone();
            entries.push(self.item("Blame", cx, move |this, _, cx| this.open_blame(&blame, cx)).icon(ui::IconName::History).into());
        }
        entries.push(MenuEntry::Separator);
        let target = file.clone();
        entries.push(if file.staged {
            self.item("Unstage", cx, move |this, _, cx| this.set_staged(vec![target.clone()], false, cx))
                .icon(ui::IconName::Minus)
                .into()
        } else {
            self.item("Stage", cx, move |this, _, cx| this.set_staged(vec![target.clone()], true, cx))
                .icon(ui::IconName::Plus)
                .into()
        });
        let (name, path) = (file.name.clone(), file.path.clone());
        entries.push(
            self.item("Stash File", cx, move |this, _, cx| this.stash(format!("Stash {name}"), Some(vec![path.clone()]), cx))
                .icon(ui::IconName::Archive)
                .into(),
        );
        let path = file.path.clone();
        entries.push(self.item("Copy Path", cx, move |this, _, cx| this.copy(path.clone(), cx)).icon(ui::IconName::Copy).into());
        if can_discard(file) {
            let target = file.clone();
            entries.push(MenuEntry::Separator);
            entries.push(
                self.item("Discard Changes", cx, move |this, window, cx| {
                    let position = window.mouse_position();
                    this.confirm_discard(vec![target.clone()], position, window, cx)
                })
                    .icon(ui::IconName::Trash)
                    .destructive()
                    .into(),
            );
        }
        entries
    }

    fn remote_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let (ahead, behind) = self.ahead_behind();
        let busy = self.remote_action.is_some();
        let label = |verb: &str, count: usize| {
            if count > 0 { format!("{verb} {}", plural(count, "commit")) } else { verb.to_string() }
        };
        vec![
            self.item(label("Push", ahead), cx, |this, _, cx| this.run_remote(RemoteOp::Push, cx))
                .icon(ui::IconName::ArrowUp)
                .disabled(busy)
                .into(),
            self.item(label("Pull", behind), cx, |this, _, cx| this.run_remote(RemoteOp::Pull, cx))
                .icon(ui::IconName::ArrowDown)
                .disabled(busy)
                .into(),
            self.item("Fetch", cx, |this, _, cx| this.run_remote(RemoteOp::Fetch, cx))
                .icon(ui::IconName::ArrowCounterClockwise)
                .disabled(busy)
                .into(),
            MenuEntry::Separator,
            // The three that used to be rows under the file list. They open beside the sidebar,
            // as History does.
            self.section_item(GitSection::Remotes, ui::IconName::Globe, cx),
            self.section_item(GitSection::Tags, ui::IconName::Tag, cx),
            self.section_item(GitSection::Stashes, ui::IconName::Stack, cx),
        ]
    }

    /// A menu entry that opens one of the footer's lists in the secondary column.
    fn section_item(&self, section: GitSection, icon: ui::IconName, cx: &Context<Self>) -> MenuEntry {
        self.item(section.title(), cx, move |this, _, cx| {
            this.open_menu = None;
            this.open_section(Some(section), cx);
        })
        .icon(icon)
        .into()
    }

    fn commit_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let has_message = !self.commit_message(cx).is_empty();
        vec![
            self.item("Commit & Push", cx, |this, _, cx| this.commit(true, false, cx))
                .icon(ui::IconName::ArrowUp)
                .disabled(!self.can_commit(cx))
                .into(),
            self.item("Stage All & Commit", cx, |this, _, cx| this.commit(false, true, cx))
                .disabled(!has_message || self.file_count() == 0 || self.committing)
                .into(),
        ]
    }

    /// Which sidebar views and repository items show (the Visibility submenu).
    fn visibility_menu(&self, cx: &Context<Self>) -> MenuItem {
        let item = |id: &'static str, label: &'static str, icon: ui::IconName| -> MenuEntry {
            let visible = self.is_visible(id);
            self.item(label, cx, move |this, _, cx| {
                let visible = this.is_visible(id);
                this.set_item_visible(id, !visible, cx)
            }).icon(icon).checked(visible).keep_open().into()
        };
        MenuItem::new("Visibility").icon(ui::IconName::Eye).submenu(vec![
            item("changes", "Changes", ui::IconName::GitDiff),
            item("history", "History", ui::IconName::History),
        ])
    }

    /// The "Git actions" menu at the end of the sidebar's top row.
    fn actions_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let refresh = self.item("Refresh status", cx, |this, _, cx| this.refresh(cx)).icon(ui::IconName::ArrowClockwise);
        if !matches!(self.repo, RepoState::Ready(_)) {
            return vec![
                self.item(if self.initializing { "Initializing…" } else { "Initialize repository" }, cx, |this, _, cx| {
                    this.initialize(cx)
                })
                .icon(ui::IconName::Settings)
                .disabled(self.initializing)
                .into(),
                self.item("Select repository…", cx, |this, _, cx| this.select_repository(cx)).icon(ui::IconName::FolderOpen).into(),
                MenuEntry::Separator,
                self.visibility_menu(cx).into(),
                refresh.into(),
            ];
        }
        let busy = self.remote_action.is_some();
        vec![
            self.item("Select repository…", cx, |this, _, cx| this.select_repository(cx)).icon(ui::IconName::FolderOpen).into(),
            self.item("Switch branch…", cx, |this, window, cx| {
                let position = window.mouse_position();
                this.open_menu = None;
                this.show_branches_menu(position, Anchor::TopRight, window, cx)
            })
            .icon(ui::IconName::GitBranch)
            .into(),
            self.item("Show branch diff", cx, |this, window, cx| {
                let position = window.mouse_position();
                this.open_menu = None;
                this.show_branch_picker(position, window, cx)
            })
            .icon(ui::IconName::GitPullRequest)
            .into(),
            MenuEntry::Separator,
            self.item("Push changes", cx, |this, _, cx| this.run_remote(RemoteOp::Push, cx))
                .icon(ui::IconName::Upload)
                .disabled(busy)
                .into(),
            self.item("Pull changes", cx, |this, _, cx| this.run_remote(RemoteOp::Pull, cx))
                .icon(ui::IconName::Download)
                .disabled(busy)
                .into(),
            self.item("Fetch", cx, |this, _, cx| this.run_remote(RemoteOp::Fetch, cx))
                .icon(ui::IconName::GitPullRequest)
                .disabled(busy)
                .into(),
            MenuEntry::Separator,
            self.section_item(GitSection::Remotes, ui::IconName::HardDrives, cx),
            self.section_item(GitSection::Tags, ui::IconName::Tag, cx),
            self.section_item(GitSection::Stashes, ui::IconName::Archive, cx),
            MenuEntry::Separator,
            self.visibility_menu(cx).into(),
            refresh.into(),
            MenuEntry::Separator,
            self.item("Discard all changes", cx, |this, window, cx| {
                if this.settings.confirm_discard {
                    let position = window.mouse_position();
                    this.confirm_discard_all(position, window, cx)
                } else {
                    this.discard_all(cx)
                }
            })
            .icon(ui::IconName::ArrowCounterClockwise)
            .destructive()
            .into(),
        ]
    }
}

/// The status word a commit message context lists a file with.
fn status_word(status: FileStatus) -> &'static str {
    match status {
        FileStatus::Modified => "modified",
        FileStatus::Added => "added",
        FileStatus::Deleted => "deleted",
        FileStatus::Renamed => "renamed",
        FileStatus::Untracked => "untracked",
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, process::Command, rc::Rc};

    #[test]
    fn a_failed_worktree_removal_says_why_and_offers_the_fix() {
        let broken = "Git worktree remove failed: fatal: validation failed, cannot remove working tree: '/tmp/wt/.git' does not exist";
        let (message, action) = super::worktree_removal_problem(broken, "/tmp/wt", false);
        assert!(message.contains("no longer a Git worktree"), "{message}");
        assert!(matches!(action, Some(super::NoticeAction::PruneWorktrees)));

        let dirty = "Git worktree remove failed: fatal: '/tmp/wt' contains modified or untracked files, use --force to delete it";
        let (_, action) = super::worktree_removal_problem(dirty, "/tmp/wt", false);
        assert!(matches!(action, Some(super::NoticeAction::ForceRemoveWorktree(path)) if path == "/tmp/wt"));
        // Forced already: nothing more to offer.
        let (_, action) = super::worktree_removal_problem(dirty, "/tmp/wt", true);
        assert!(action.is_none());
    }

    #[test]
    fn git_errors_lose_their_prefixes() {
        assert_eq!(super::clean_git_error("Git push failed: fatal: the remote end hung up"), "The remote end hung up");
        assert_eq!(super::clean_git_error("error: pathspec 'x' did not match"), "Pathspec 'x' did not match");
    }

    use gpui::TestAppContext;

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        assert!(Command::new("git").args(args).current_dir(dir).status().unwrap().success(), "git {args:?}");
    }

    /// A repository with `a.txt` committed, then changed.
    fn changed_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-q", "-b", "main"]);
        git(dir.path(), &["config", "user.name", "Test"]);
        git(dir.path(), &["config", "user.email", "test@example.com"]);
        git(dir.path(), &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        git(dir.path(), &["add", "."]);
        git(dir.path(), &["commit", "-q", "-m", "Start the notes"]);
        std::fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        dir
    }

    fn settle(cx: &mut gpui::VisualTestContext, done: impl Fn(&mut gpui::VisualTestContext) -> bool) {
        for _ in 0..300 {
            cx.run_until_parked();
            if done(cx) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("timed out");
    }

    #[gpui::test]
    fn keeps_a_copy_in_local_history_before_discarding(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = changed_repo();
        let kept: Arc<std::sync::Mutex<Vec<(PathBuf, String)>>> = Arc::default();
        let fail = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let (record, failing) = (kept.clone(), fail.clone());
        cx.update(|cx| {
            theme::init(cx, None, theme::Appearance::Dark, false);
            ui::init(cx);
            set_discard_snapshot(
                cx,
                Arc::new(move |path: &Path| {
                    if failing.load(std::sync::atomic::Ordering::SeqCst) {
                        anyhow::bail!("disk full");
                    }
                    record.lock().unwrap().push((path.to_path_buf(), std::fs::read_to_string(path)?));
                    Ok(())
                }),
            );
        });
        let root = dir.path().to_path_buf();
        let (panel, cx) = cx.add_window_view(|window, cx| GitPanel::new(root, window, cx));
        settle(cx, |cx| panel.read_with(cx, |panel, _| !panel.groups.unstaged.is_empty()));
        let files = panel.read_with(cx, |panel, _| panel.groups.unstaged.clone());

        panel.update(cx, |panel, cx| panel.discard(files.clone(), true, cx));
        // The failure is a toast that offers to discard without the copy.
        let offers_discard = |cx: &mut gpui::VisualTestContext| {
            cx.read(|cx| {
                cx.try_global::<notifications::Notifications>()
                    .is_some_and(|store| store.toasts().any(|toast| toast.action.as_ref().is_some_and(|action| action.label.as_ref() == "Discard Anyway")))
            })
        };
        settle(cx, |cx| offers_discard(cx));
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "one\ntwo\n");

        fail.store(false, std::sync::atomic::Ordering::SeqCst);
        panel.update(cx, |panel, cx| panel.discard(files, true, cx));
        settle(cx, |cx| panel.read_with(cx, |panel, _| panel.groups.unstaged.is_empty()));
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "one\n");
        let kept = kept.lock().unwrap();
        assert_eq!(kept.len(), 1);
        assert!(kept[0].0.ends_with("a.txt"));
        assert_eq!(kept[0].1, "one\ntwo\n");
    }

    #[gpui::test]
    fn generates_a_commit_subject_through_the_hook(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = changed_repo();
        git(dir.path(), &["add", "."]);

        let asked: Rc<RefCell<Vec<CommitMessageRequest>>> = Rc::default();
        let record = asked.clone();
        cx.update(|cx| {
            theme::init(cx, None, theme::Appearance::Dark, false);
            ui::init(cx);
            set_commit_message_generator(
                cx,
                Rc::new(move |request, _| {
                    record.borrow_mut().push(request);
                    Task::ready(Ok("```\nAdd the second line\nWith a body\n```".into()))
                }),
            );
        });
        let root = dir.path().to_path_buf();
        let (panel, cx) = cx.add_window_view(|window, cx| GitPanel::new(root, window, cx));
        for _ in 0..200 {
            cx.run_until_parked();
            if panel.read_with(cx, |panel, _| !panel.groups.staged.is_empty()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panel.update(cx, |panel, cx| panel.generate_message(cx));
        for _ in 0..200 {
            cx.run_until_parked();
            if panel.read_with(cx, |panel, _| !panel.generating) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panel.read_with(cx, |panel, cx| assert_eq!(panel.commit_message(cx), "Add the second line"));
        let asked = asked.borrow();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].instruction, commit_message::TITLE_INSTRUCTION);
        assert!(asked[0].context.contains("Branch: main"), "{}", asked[0].context);
        assert!(asked[0].context.contains("- Start the notes"));
        assert!(asked[0].context.contains("- modified staged: a.txt"));
        assert!(asked[0].context.contains("### a.txt\n+two"));
    }
}
