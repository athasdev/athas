//! What a view inside the workbench can ask of it without depending on it: open a file at a
//! line, open another tool's view, show a session. The workbench takes the requests as they come.

use std::path::PathBuf;

use gpui::{App, Global};

#[derive(Clone, Debug, PartialEq)]
pub enum OpenRequest {
    /// A file, at a 1-based line and column when given.
    File { path: PathBuf, line: Option<u32>, column: Option<u32> },
    /// A file with a byte range of its text selected and scrolled into view.
    FileSelection { path: PathBuf, range: std::ops::Range<usize> },
    /// A tool's centre view, as `workspace::TabItem::Resource` names it.
    Resource { kind: String, id: String, title: String },
    /// A new title for a tool's open tabs, such as a web page's, without bringing them to the front.
    RenameResource { kind: String, id: String, title: String },
    /// An agent session by id.
    Session { id: String },
    /// Folders another editor opened recently, to add to the recent projects.
    ImportRecentProjects(Vec<ImportedProject>),
    /// Settings, on a page (`general`, `keyboard`, …) and with a search, when given.
    Settings { page: Option<String>, query: Option<String> },
    /// A new terminal running `command`, in `cwd` (the project when `None`).
    Terminal { command: String, cwd: Option<PathBuf> },
    /// A folder (local, `remote://` or `wsl://`) as a project, switching to it when it is open.
    Project { path: String },
    /// A folder as the project of a new window (a worktree's Open in New Window).
    ProjectInNewWindow { path: String },
    /// A saved SSH connection, connected through the remote connections dialog.
    RemoteConnection { id: String },
    /// The remote connections dialog on its new-connection form.
    AddRemoteConnection,
    /// The API key dialog, on this provider when given.
    ProviderApiKey { provider: Option<String> },
    /// A cloud run as an agent session: the one following it, or a new one.
    CloudRunSession { run_id: String },
    /// A web link clicked inside an agent session: a server the session runs opens in its own
    /// browser, any other page in a browser tab.
    SessionLink { session: String, url: String },
    /// Settings > AI > Clear chat history: every agent session goes from the workspace (sidebar,
    /// tabs, dashboard). The caller deletes transcripts and checkpoints itself.
    ClearChatHistory,
}

/// The separator between the project and a skill's id in a Skills resource id.
pub const SKILL_ID_SEPARATOR: char = '\u{1f}';

/// Asks the workbench to remove every agent session from the workspace (`clearAllChats`).
pub fn clear_chat_history(cx: &mut App) {
    request(cx, OpenRequest::ClearChatHistory);
}

/// Opens the Skills view of `project` (the user's skills when `None`) with the editor of the skill
/// whose id is `skill` open (a skill's "Edit…"). The resource is `skills` with the id
/// `"<project>\u{1f}<skill id>"`.
pub fn open_skill(cx: &mut App, project: Option<&std::path::Path>, skill: &str) {
    let project = project.map(|project| project.to_string_lossy().into_owned()).unwrap_or_default();
    open_resource(cx, "skills", &format!("{project}{SKILL_ID_SEPARATOR}{skill}"), "Skills");
}

/// A folder another editor reported, and which editor it was.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportedProject {
    pub path: String,
    pub source_id: String,
    pub source_name: String,
}

#[derive(Default)]
pub struct OpenRequests(Vec<OpenRequest>);

impl Global for OpenRequests {}

/// Asks the workbench to open something; it does on its next turn.
pub fn request(cx: &mut App, request: OpenRequest) {
    cx.default_global::<OpenRequests>().0.push(request);
}

pub fn open_file(cx: &mut App, path: impl Into<PathBuf>, line: Option<u32>) {
    request(cx, OpenRequest::File { path: path.into(), line, column: None });
}

/// Opens a file with `range` (byte offsets into its text) selected.
pub fn open_file_selection(cx: &mut App, path: impl Into<PathBuf>, range: std::ops::Range<usize>) {
    request(cx, OpenRequest::FileSelection { path: path.into(), range });
}

pub fn open_provider_api_key(cx: &mut App, provider: Option<&str>) {
    request(cx, OpenRequest::ProviderApiKey { provider: provider.map(str::to_string) });
}

pub fn open_settings(cx: &mut App, page: Option<&str>, query: Option<&str>) {
    request(cx, OpenRequest::Settings { page: page.map(str::to_string), query: query.map(str::to_string) });
}

pub fn run_in_terminal(cx: &mut App, command: impl Into<String>, cwd: Option<PathBuf>) {
    request(cx, OpenRequest::Terminal { command: command.into(), cwd });
}

pub fn open_resource(cx: &mut App, kind: &str, id: &str, title: &str) {
    request(cx, OpenRequest::Resource { kind: kind.into(), id: id.into(), title: title.into() });
}

pub fn rename_resource(cx: &mut App, kind: &str, id: &str, title: &str) {
    request(cx, OpenRequest::RenameResource { kind: kind.into(), id: id.into(), title: title.into() });
}

pub fn open_project(cx: &mut App, path: impl Into<String>) {
    request(cx, OpenRequest::Project { path: path.into() });
}

pub fn open_project_in_new_window(cx: &mut App, path: impl Into<String>) {
    request(cx, OpenRequest::ProjectInNewWindow { path: path.into() });
}

/// The window's projects, for views that cannot read the workbench's state.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Projects {
    pub active: Option<String>,
    pub open: Vec<String>,
}

impl Global for Projects {}

pub fn projects(cx: &App) -> Projects {
    cx.try_global::<Projects>().cloned().unwrap_or_default()
}

/// Kept by the workbench; observers are told only when the projects change.
pub fn set_projects(cx: &mut App, projects: Projects) {
    if cx.try_global::<Projects>() != Some(&projects) {
        cx.set_global(projects);
    }
}

/// The repository the Git panel has selected (its working-tree root), for views that cannot read
/// the panel, such as the agent's context references. `None` while it is discovering, when the
/// project is not a repository, or when the panel is not open.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GitRepository(pub Option<PathBuf>);

impl Global for GitRepository {}

pub fn git_repository(cx: &App) -> Option<PathBuf> {
    cx.try_global::<GitRepository>().and_then(|repository| repository.0.clone())
}

/// Kept by the workbench; observers are told only when the repository changes.
pub fn set_git_repository(cx: &mut App, root: Option<PathBuf>) {
    let repository = GitRepository(root);
    if cx.try_global::<GitRepository>().cloned().unwrap_or_default() != repository {
        cx.set_global(repository);
    }
}

/// A tab open in the centre, for the agent's Add context menu.
#[derive(Clone, Debug, PartialEq)]
pub struct OpenTab {
    pub title: String,
    /// The file a file tab shows.
    pub path: Option<PathBuf>,
    /// A tool view's kind and id, as `workspace::TabItem::Resource` names them.
    pub kind: Option<String>,
    pub id: Option<String>,
    /// The tab in front of the focused pane group.
    pub active: bool,
    /// A file tab whose editor holds changes not saved yet.
    pub dirty: bool,
    /// The language a file tab's editor reads it as, such as `Rust`, once its editor exists.
    pub language: Option<String>,
}

/// The file in front, when the focused tab shows one.
pub fn active_file(cx: &App) -> Option<PathBuf> {
    cx.try_global::<OpenTabs>()?.0.iter().find(|tab| tab.active).and_then(|tab| tab.path.clone())
}

/// The tab in front, when it is open.
pub fn active_tab(cx: &App) -> Option<OpenTab> {
    cx.try_global::<OpenTabs>()?.0.iter().find(|tab| tab.active).cloned()
}

/// How an AI prompt names the file in front: its path, the language it is read as, and
/// "[unsaved changes]" while it has some (`ai-context-builder`'s current file line).
pub fn describe_active_file(cx: &App) -> Option<String> {
    describe_tab(active_tab(cx)?)
}

fn describe_tab(tab: OpenTab) -> Option<String> {
    let path = tab.path?;
    let mut line = path.display().to_string();
    if let Some(language) = tab.language.filter(|language| !matches!(language.as_str(), "" | "Text" | "Plain Text")) {
        line.push_str(&format!(" ({language})"));
    }
    if tab.dirty {
        line.push_str(" [unsaved changes]");
    }
    Some(line)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct OpenTabs(pub Vec<OpenTab>);

impl Global for OpenTabs {}

pub fn open_tabs(cx: &App) -> Vec<OpenTab> {
    cx.try_global::<OpenTabs>().map(|tabs| tabs.0.clone()).unwrap_or_default()
}

/// Kept by the workbench as tabs open and close.
pub fn set_open_tabs(cx: &mut App, tabs: Vec<OpenTab>) {
    if cx.try_global::<OpenTabs>().map(|open| &open.0) != Some(&tabs) {
        cx.set_global(OpenTabs(tabs));
    }
}

/// The requests made since the last call, oldest first.
/// Taking nothing leaves the global untouched, so its observers are not told again.
pub fn take(cx: &mut App) -> Vec<OpenRequest> {
    if cx.try_global::<OpenRequests>().is_none_or(|requests| requests.0.is_empty()) {
        return Vec::new();
    }
    std::mem::take(&mut cx.global_mut::<OpenRequests>().0)
}

/// Where the update check stands, for the Settings "Version" row. The platform crate keeps it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UpdateStatus {
    /// The newer version a check found.
    pub available: Option<String>,
    pub checking: bool,
    pub downloading: bool,
    /// How much of the update has downloaded, in percent.
    pub progress: Option<u8>,
    pub installing: bool,
    /// Athas cannot replace itself here, so the update is downloaded from the website instead.
    pub download_only: bool,
    /// Why the last check failed.
    pub error: Option<String>,
}

impl Global for UpdateStatus {}

/// An installed update waits for the quit that is under way: Athas starts again instead of
/// exiting once every window has closed.
#[derive(Default)]
pub struct RestartAfterQuit(pub bool);

impl Global for RestartAfterQuit {}

pub fn restart_after_quit(cx: &mut App) -> bool {
    cx.try_global::<RestartAfterQuit>().is_some_and(|restart| restart.0)
}

pub fn update_status(cx: &App) -> UpdateStatus {
    cx.try_global::<UpdateStatus>().cloned().unwrap_or_default()
}

pub fn set_update_status(cx: &mut App, change: impl FnOnce(&mut UpdateStatus)) {
    change(cx.default_global::<UpdateStatus>());
}

/// What a file choice answers with: the chosen file's path on the workspace server, after it
/// was uploaded there, or `None` when nothing was chosen or the upload failed.
pub type UploadDone = Box<dyn FnOnce(Result<Option<PathBuf>, String>, &mut App)>;

/// The browser's file access on the web, where native file dialogs do not exist: a file input
/// whose choice is uploaded to the workspace server, and downloads.
#[derive(Clone)]
pub struct WebFiles {
    /// Lets the user choose a file (`accept` as an `<input type=file>` takes it).
    pub upload: std::rc::Rc<dyn Fn(Option<&str>, UploadDone, &mut App)>,
    /// Saves `bytes` as a download named `name`.
    pub download: std::rc::Rc<dyn Fn(&str, Vec<u8>, &mut App)>,
    /// A new empty folder on the server for files on their way to the browser.
    pub transfer_dir: std::rc::Rc<dyn Fn(&mut App) -> Result<PathBuf, String>>,
    /// Downloads a file from a transfer folder.
    pub download_transfer: std::rc::Rc<dyn Fn(&std::path::Path, &mut App) -> Result<(), String>>,
}

impl Global for WebFiles {}

/// The browser's file access, on the web only.
pub fn web_files(cx: &App) -> Option<WebFiles> {
    cx.try_global::<WebFiles>().cloned()
}

pub fn set_web_files(cx: &mut App, files: WebFiles) {
    cx.set_global(files);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_file_line_names_language_and_unsaved_changes() {
        let tab = OpenTab { title: "main.rs".into(), path: Some("/p/main.rs".into()), kind: None, id: None, active: true, dirty: true, language: Some("Rust".into()) };
        assert_eq!(describe_tab(tab.clone()).as_deref(), Some("/p/main.rs (Rust) [unsaved changes]"));
        let plain = OpenTab { dirty: false, language: Some("Plain Text".into()), ..tab.clone() };
        assert_eq!(describe_tab(plain).as_deref(), Some("/p/main.rs"));
        assert_eq!(describe_tab(OpenTab { path: None, ..tab }), None);
    }
}

/// Reads what an open editor holds for a file, unsaved edits included; the workbench installs it.
#[derive(Clone)]
pub struct BufferTextReader(pub std::rc::Rc<dyn Fn(&std::path::Path, &App) -> Option<String>>);

impl Global for BufferTextReader {}

/// Installs the reader `buffer_text` asks.
pub fn set_buffer_text_reader(cx: &mut App, reader: impl Fn(&std::path::Path, &App) -> Option<String> + 'static) {
    cx.set_global(BufferTextReader(std::rc::Rc::new(reader)));
}

/// Puts new text into an open editor as one undoable edit, leaving it unsaved; the workbench
/// installs it.
#[derive(Clone)]
pub struct BufferTextWriter(pub std::rc::Rc<dyn Fn(&std::path::Path, &str, &mut App) -> bool>);

impl Global for BufferTextWriter {}

/// Installs the writer `write_buffer_text` asks.
pub fn set_buffer_text_writer(cx: &mut App, writer: impl Fn(&std::path::Path, &str, &mut App) -> bool + 'static) {
    cx.set_global(BufferTextWriter(std::rc::Rc::new(writer)));
}

/// Replaces the text of the editor that has `path` open, as an edit the user can undo and save
/// (search's replace in an open file, `updateBufferContent(…, true)`). False when no editor has it.
pub fn write_buffer_text(path: &std::path::Path, text: &str, cx: &mut App) -> bool {
    let Some(writer) = cx.try_global::<BufferTextWriter>().map(|writer| writer.0.clone()) else { return false };
    writer(path, text, cx)
}

/// How many times the open editors of each file have changed, bumped by the workbench on every
/// edit (`BufferEdits::changed`). Views that follow an open file (attached tabs) observe this
/// global with `cx.observe_global::<BufferEdits>` and compare [`buffer_generation`] instead of
/// polling the text.
#[derive(Default)]
pub struct BufferEdits(std::collections::HashMap<PathBuf, u64>);

impl Global for BufferEdits {}

impl BufferEdits {
    /// Marks `path` changed; the workbench calls it for every edit of an open editor.
    pub fn changed(path: &std::path::Path, cx: &mut App) {
        *cx.default_global::<BufferEdits>().0.entry(path.to_path_buf()).or_default() += 1;
    }
}

/// The edit count of `path`'s open editors since the app started (0 when never edited).
pub fn buffer_generation(path: &std::path::Path, cx: &App) -> u64 {
    cx.try_global::<BufferEdits>().and_then(|edits| edits.0.get(path).copied()).unwrap_or(0)
}

/// The text of `path` as an open editor holds it, unsaved changes included, or `None` when no
/// window has the file open (`getOpenBufferContent`, answering an agent's `fs/read_text_file`).
pub fn buffer_text(path: &std::path::Path, cx: &App) -> Option<String> {
    let reader = cx.try_global::<BufferTextReader>()?.0.clone();
    reader(path, cx)
}
