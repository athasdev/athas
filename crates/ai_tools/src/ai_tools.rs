//! The workspace tools of Athas's built-in agent: reading, editing, writing, deleting, listing and
//! searching files inside a project, and deciding which shell commands may run without asking.
//!
//! Every path the model sends is relative to the workspace root. Paths that leave the workspace,
//! pass through a symbolic link, name credentials (`.env`, keys) or match the workspace's AI
//! ignore files (`.athasignore`, `.aiignore`, `.cursorignore`) are refused.
//!
//! Ported from Athas's `crates/ai/src/workspace_tools.rs`, `crates/project/src/file_mutations.rs`
//! and `features/ai/intelligence/services/intelligence-command-allowlist.ts`.

pub mod command_policy;
pub mod workspace_changes;

use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

/// Lines `read_file` hands the model at a time.
pub const READ_LINES: usize = 250;
/// Characters of one `read_file` page at most.
pub const READ_CHARS: usize = 24_000;

pub(crate) const MAX_FILE_BYTES: u64 = 256 * 1024;
/// Search skips files larger than this; they are almost never hand-written source.
const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
/// A walk stops after this many files, so a huge tree cannot stall the agent.
const MAX_WALKED_FILES: usize = 100_000;
const MAX_SEARCH_BYTES: u64 = 256 * 1024 * 1024;
const DEFAULT_LIST_LIMIT: usize = 500;
const MAX_LIST_LIMIT: usize = 2000;
const DEFAULT_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_MATCHES_PER_FILE: usize = 50;
const MAX_CONTEXT_LINES: usize = 5;
const MAX_LINE_CHARS: usize = 300;
const MAX_EDITS: usize = 64;
/// A command naming more paths than this is not checked; it waits for approval instead.
const MAX_CONTAINMENT_PATHS: usize = 256;

const AI_IGNORE_FILES: [&str; 3] = [".athasignore", ".aiignore", ".cursorignore"];

const CHANGED_SINCE_READ: &str = "The file changed since it was read. Read it again before editing.";
const FILE_CHANGED: &str = "The file changed while preparing the update. Read it again before editing.";

/// The workspace's AI ignore files, read fresh for every call so edits to them apply at once.
struct AiIgnore(Vec<ignore::gitignore::Gitignore>);

impl AiIgnore {
    fn load(root: &Path) -> Result<Self, String> {
        let mut matchers = Vec::new();
        for name in AI_IGNORE_FILES {
            let path = root.join(name);
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("Could not read {name}: {error}")),
            };
            if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
                return Err(format!("{name} must be a regular text file smaller than 256 KiB."));
            }
            let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
            if let Some(error) = builder.add(&path) {
                return Err(format!("Could not read {name}: {error}"));
            }
            matchers.push(builder.build().map_err(|error| error.to_string())?);
        }
        Ok(Self(matchers))
    }

    fn excludes(&self, path: &Path, is_dir: bool) -> bool {
        self.0.iter().any(|matcher| matcher.matched_path_or_any_parents(path, is_dir).is_ignore())
    }
}

/// Which files may go to an agent as context (`loadAgentContextPolicy`): none with `..`, version
/// control internals or credentials in their path, and inside the project none its AI ignore
/// files exclude. Paths outside the project are allowed.
pub struct ContextPolicy {
    root: Option<PathBuf>,
    ignore: AiIgnore,
}

impl ContextPolicy {
    pub fn allows(&self, path: &Path, is_dir: bool) -> bool {
        if path.components().any(|part| matches!(part, Component::ParentDir)) || excluded_path(path) {
            return false;
        }
        let Some(root) = &self.root else { return true };
        match path.strip_prefix(root) {
            Ok(relative) if relative.as_os_str().is_empty() => true,
            Ok(_) => !self.ignore.excludes(path, is_dir),
            Err(_) => true,
        }
    }
}

/// The context policy of the project at `root`; an AI ignore file that is not a small text file
/// is an error.
pub fn context_policy(root: Option<&Path>) -> Result<ContextPolicy, String> {
    let ignore = match root {
        Some(root) => AiIgnore::load(root)?,
        None => AiIgnore(Vec::new()),
    };
    Ok(ContextPolicy { root: root.map(Path::to_path_buf), ignore })
}

/// Whether a path names version control internals or credentials, which no tool touches.
fn excluded_path(relative: &Path) -> bool {
    relative.components().any(|part| {
        let name = part.as_os_str().to_string_lossy().to_ascii_lowercase();
        name == ".git"
            || name == ".env"
            || name.starts_with(".env.")
            || ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"].iter().any(|prefix| name.starts_with(prefix))
            || [".pem", ".key", ".p12", ".pfx"].iter().any(|extension| name.ends_with(extension))
    })
}

fn is_plain_relative(relative: &Path) -> bool {
    !relative.is_absolute() && relative.components().all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
}

/// Resolves `relative` inside `root`, refusing anything a workspace tool must not touch. With
/// `create`, the file (and folders above it) may not exist yet.
fn permitted_path(root: &Path, relative: &str, create: bool) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let relative = Path::new(relative);
    if !is_plain_relative(relative) {
        return Err("Use a relative path inside the workspace.".into());
    }
    if excluded_path(relative) {
        return Err("This file is excluded from automatic workspace tools.".into());
    }
    let target = root.join(relative);
    if AiIgnore::load(&root)?.excludes(&target, target.is_dir()) {
        return Err("This path is excluded by the workspace AI ignore files.".into());
    }
    let mut component_path = root.clone();
    for component in relative.components() {
        component_path.push(component);
        if fs::symlink_metadata(&component_path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err("Use the original workspace path instead of a symbolic link.".into());
        }
    }
    let resolved = match fs::canonicalize(&target) {
        Ok(path) => path,
        Err(error) if create && error.kind() == std::io::ErrorKind::NotFound => {
            // New files may sit in folders that do not exist yet: resolve the nearest existing
            // ancestor and append the rest, which the symlink check above already walked.
            let mut existing = target.parent().ok_or("A file path is required.")?;
            let mut missing = vec![target.file_name().ok_or("A file name is required.")?];
            while !existing.exists() {
                missing.push(existing.file_name().ok_or("A file path is required.")?);
                existing = existing.parent().ok_or("A file path is required.")?;
            }
            let mut resolved = fs::canonicalize(existing).map_err(|e| e.to_string())?;
            for part in missing.iter().rev() {
                resolved.push(part);
            }
            resolved
        }
        Err(error) => return Err(error.to_string()),
    };
    if !resolved.starts_with(&root) || resolved == root {
        return Err("The path must remain inside the workspace.".into());
    }
    if excluded_path(resolved.strip_prefix(&root).map_err(|e| e.to_string())?) {
        return Err("This file is excluded from automatic workspace tools.".into());
    }
    Ok(resolved)
}

/// Whether each of `paths`, taken relative to `root` the way a command in the workspace sees it,
/// stays inside the workspace and away from secret files once symbolic links are followed. A
/// path that does not exist is judged by its nearest existing folder.
pub fn paths_stay_in_workspace(root: &Path, paths: &[String]) -> bool {
    if paths.len() > MAX_CONTAINMENT_PATHS {
        return false;
    }
    let Ok(root) = fs::canonicalize(root) else { return false };
    let Ok(ai_ignore) = AiIgnore::load(&root) else { return false };
    paths.iter().all(|path| {
        let mut existing = root.join(path);
        let mut missing = Vec::new();
        let resolved = loop {
            match fs::canonicalize(&existing) {
                Ok(resolved) => break resolved,
                Err(_) => {
                    let Some(name) = existing.file_name().map(ToOwned::to_owned) else { return false };
                    missing.push(name);
                    if !existing.pop() {
                        return false;
                    }
                }
            }
        };
        let resolved = missing.iter().rev().fold(resolved, |path, part| path.join(part));
        resolved
            .strip_prefix(&root)
            .is_ok_and(|relative| !excluded_path(relative) && !ai_ignore.excludes(&resolved, resolved.is_dir()))
    })
}

/// Whether the agent may run `command` in `root` without asking: a built-in read-only command or
/// one matching a remembered prefix, whose path arguments stay in the workspace.
pub fn command_auto_approved(root: &Path, command: &str, allowed_prefixes: &[String]) -> bool {
    let approved =
        command_policy::is_builtin_safe_command(command) || command_policy::matches_allowed_prefix(command, allowed_prefixes);
    if !approved {
        return false;
    }
    let paths = command_policy::command_path_arguments(command);
    paths.is_empty() || paths_stay_in_workspace(root, &paths)
}

/// Reads a workspace text file of at most 256 KiB.
pub fn read_file(root: &Path, path: &str) -> Result<String, String> {
    let target = permitted_path(root, path, false)?;
    let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("Read a text file smaller than 256 KiB.".into());
    }
    let mut content = String::new();
    fs::File::open(target)
        .map_err(|e| e.to_string())?
        .take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("Read a text file smaller than 256 KiB.".into());
    }
    Ok(content)
}

/// One exact replacement of an agent edit. `old_text` must match exactly one location unless
/// `replace_all` is set.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Replacement {
    pub old_text: String,
    pub new_text: String,
    #[serde(default)]
    pub replace_all: bool,
}

/// A write that landed: what the file held before (`None` when the write created it) and what it
/// holds now, so the change can be shown and reviewed.
#[derive(Clone, Debug, PartialEq)]
pub struct FileWrite {
    /// The file's absolute path, the workspace root joined with the path the model sent.
    pub path: PathBuf,
    pub previous_content: Option<String>,
    pub content: String,
}

/// The root joined with `relative` without `.` parts, the way open editors know the file.
pub(crate) fn display_path(root: &Path, relative: &str) -> PathBuf {
    let relative: PathBuf = Path::new(relative).components().filter(|part| matches!(part, Component::Normal(_))).collect();
    root.join(relative)
}

/// Applies `edits` in order to the version of the file the agent read, all or nothing.
pub fn edit_file(root: &Path, path: &str, expected_content: &str, edits: &[Replacement]) -> Result<FileWrite, String> {
    if edits.is_empty() || edits.len() > MAX_EDITS {
        return Err(format!("Send between 1 and {MAX_EDITS} edits."));
    }
    let target = permitted_path(root, path, false)?;
    let result = mutate_text(&target, |current| {
        let current = current.ok_or("The file does not exist. Use write_file to create it.")?;
        if current != expected_content {
            return Err(CHANGED_SINCE_READ.into());
        }
        let mut content = current.to_string();
        for (index, edit) in edits.iter().enumerate() {
            let number = index + 1;
            if edit.old_text.is_empty() {
                return Err(format!("Edit {number}: oldText must not be empty."));
            }
            let count = content.matches(edit.old_text.as_str()).count();
            if count == 0 {
                return Err(format!(
                    "Edit {number}: oldText was not found. Earlier edits in the same call apply first; no edit was applied."
                ));
            }
            if count > 1 && !edit.replace_all {
                return Err(format!(
                    "Edit {number}: oldText matches {count} locations. Include more surrounding lines or set replaceAll; no edit was applied."
                ));
            }
            content = if edit.replace_all {
                content.replace(edit.old_text.as_str(), &edit.new_text)
            } else {
                content.replacen(edit.old_text.as_str(), &edit.new_text, 1)
            };
        }
        if content == current {
            return Err("The edits leave the file unchanged.".into());
        }
        if content.len() as u64 > MAX_FILE_BYTES {
            return Err("The edited file would be larger than 256 KiB.".into());
        }
        Ok(Some(content))
    })?;
    Ok(FileWrite { path: display_path(root, path), previous_content: result.previous_content, content: result.content.unwrap_or_default() })
}

/// Creates a file, or replaces all of one the agent read. `expected_content` is `None` when the
/// file must not exist yet. Missing folders are created.
pub fn write_file(root: &Path, path: &str, expected_content: Option<&str>, content: &str) -> Result<FileWrite, String> {
    let target = permitted_path(root, path, true)?;
    let result = mutate_text(&target, |current| {
        if current != expected_content {
            return Err(if expected_content.is_none() {
                "The file already exists. Read it first, then edit or overwrite it.".into()
            } else {
                CHANGED_SINCE_READ.into()
            });
        }
        if content.len() as u64 > MAX_FILE_BYTES {
            return Err("The edited file would be larger than 256 KiB.".into());
        }
        Ok(Some(content.to_string()))
    })?;
    Ok(FileWrite { path: display_path(root, path), previous_content: result.previous_content, content: result.content.unwrap_or_default() })
}

/// Deletes a file the agent read, if it still holds what was read. Returns its absolute path.
pub fn delete_file(root: &Path, path: &str, expected_content: &str) -> Result<PathBuf, String> {
    let target = permitted_path(root, path, false)?;
    mutate_text(&target, |current| {
        if current != Some(expected_content) {
            return Err(CHANGED_SINCE_READ.into());
        }
        Ok(None)
    })?;
    Ok(display_path(root, path))
}

static FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());

struct TextMutation {
    previous_content: Option<String>,
    content: Option<String>,
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read file: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("The file exceeds the update size limit.".into());
    }
    String::from_utf8(bytes).map(Some).map_err(|error| format!("The file is not valid UTF-8: {error}"))
}

/// Replaces (`Some`) or deletes (`None`) the text file at the absolute `path` with what
/// `mutation` makes of its current text. Writers in this process take turns, and the disk is read
/// again just before the change lands, so a concurrent change is never overwritten. A new file is
/// written through a temporary file that never replaces one that appeared meanwhile.
fn mutate_text(path: &Path, mutation: impl FnOnce(Option<&str>) -> Result<Option<String>, String>) -> Result<TextMutation, String> {
    let guard = FILE_MUTATION_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let target = match fs::symlink_metadata(path) {
        Ok(_) => fs::canonicalize(path).map_err(|error| format!("Could not resolve file: {error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => path.to_path_buf(),
        Err(error) => return Err(format!("Could not inspect file: {error}")),
    };
    let metadata = fs::metadata(&target).ok();
    if metadata.as_ref().is_some_and(|metadata| !metadata.is_file()) {
        return Err("Only text files can be changed.".into());
    }
    let previous_content = read_text(&target)?;
    let mut content = mutation(previous_content.as_deref())?;
    // A byte order mark the file had stays, whether or not the model kept it.
    if previous_content.as_ref().is_some_and(|text| text.starts_with('\u{feff}'))
        && let Some(text) = content.as_mut()
        && !text.starts_with('\u{feff}')
    {
        text.insert(0, '\u{feff}');
    }
    if content != previous_content {
        if metadata.as_ref().is_some_and(|metadata| metadata.permissions().readonly()) {
            return Err("The file is read-only.".into());
        }
        match &content {
            Some(text) => {
                if text.len() as u64 > MAX_FILE_BYTES {
                    return Err("The update exceeds the size limit.".into());
                }
                let parent = target.parent().ok_or("Missing parent directory.")?;
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                #[cfg_attr(not(unix), allow(unused_mut))]
                let mut builder = tempfile::Builder::new();
                #[cfg(unix)]
                if previous_content.is_none() {
                    use std::os::unix::fs::PermissionsExt;
                    builder.permissions(fs::Permissions::from_mode(0o666));
                }
                let mut temporary = builder.tempfile_in(parent).map_err(|error| error.to_string())?;
                if let Some(metadata) = &metadata {
                    temporary.as_file().set_permissions(metadata.permissions()).map_err(|error| error.to_string())?;
                }
                temporary.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
                temporary.as_file().sync_all().map_err(|error| error.to_string())?;
                if read_text(&target)? != previous_content {
                    return Err(FILE_CHANGED.into());
                }
                if previous_content.is_none() {
                    temporary.persist_noclobber(&target).map_err(|error| error.to_string())?;
                } else {
                    temporary.persist(&target).map_err(|error| error.to_string())?;
                }
            }
            None => {
                if read_text(&target)? != previous_content {
                    return Err(FILE_CHANGED.into());
                }
                fs::remove_file(&target).map_err(|error| error.to_string())?;
            }
        }
    }
    drop(guard);
    Ok(TextMutation { previous_content, content })
}

fn glob_matcher(glob: Option<&str>) -> Result<Option<(globset::GlobMatcher, bool)>, String> {
    let Some(glob) = glob.map(str::trim).filter(|glob| !glob.is_empty()) else { return Ok(None) };
    let matcher = globset::GlobBuilder::new(glob)
        .literal_separator(true)
        .build()
        .map_err(|e| format!("Invalid glob: {e}"))?
        .compile_matcher();
    // A glob without a slash, like `*.ts`, matches file names in every folder.
    Ok(Some((matcher, !glob.contains('/'))))
}

pub(crate) struct WorkspaceWalk {
    /// Absolute paths with their workspace-relative spelling.
    pub(crate) files: Vec<(PathBuf, String)>,
    pub(crate) truncated: bool,
}

/// The workspace files under `subpath` that `.gitignore` does not exclude, in path order,
/// leaving out `.git`, `node_modules`, symbolic links, and credentials.
pub(crate) fn walk_workspace(root: &Path, subpath: Option<&str>, glob: Option<&str>) -> Result<WorkspaceWalk, String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let start = match subpath.map(str::trim).filter(|path| !path.is_empty() && *path != ".") {
        Some(subpath) => {
            if !is_plain_relative(Path::new(subpath)) {
                return Err("Use a relative path inside the workspace.".into());
            }
            permitted_path(root, subpath, false)?
        }
        None => canonical_root.clone(),
    };
    let matcher = glob_matcher(glob)?;
    let ai_ignore = AiIgnore::load(&canonical_root)?;
    let walker = ignore::WalkBuilder::new(&start)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .parents(true)
        .follow_links(false)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(move |entry| {
            let name = entry.file_name();
            name != ".git"
                && name != "node_modules"
                && !ai_ignore.excludes(entry.path(), entry.file_type().is_some_and(|kind| kind.is_dir()))
        })
        .build();
    let mut files = Vec::new();
    let mut truncated = false;
    for entry in walker.filter_map(Result::ok) {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(&canonical_root) else { continue };
        if excluded_path(relative) {
            continue;
        }
        if let Some((matcher, name_only)) = &matcher {
            let candidate = if *name_only { relative.file_name().map(Path::new).unwrap_or(relative) } else { relative };
            if !matcher.is_match(candidate) {
                continue;
            }
        }
        if files.len() >= MAX_WALKED_FILES {
            truncated = true;
            break;
        }
        let relative = relative.to_string_lossy().replace('\\', "/");
        files.push((entry.into_path(), relative));
    }
    Ok(WorkspaceWalk { files, truncated })
}

#[derive(Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    /// A folder to list, relative to the workspace.
    pub path: Option<String>,
    pub glob: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub files: Vec<String>,
    /// Files matched in total, of which `files` is one page.
    pub total: usize,
    /// Pass as `offset` for the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
    /// The walk stopped early, so `total` is a lower bound.
    pub truncated: bool,
}

/// One page of the workspace's files, in path order.
pub fn list_files(root: &Path, options: &ListOptions) -> Result<FileList, String> {
    let walk = walk_workspace(root, options.path.as_deref(), options.glob.as_deref())?;
    let limit = options.limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    let offset = options.offset.unwrap_or(0);
    let total = walk.files.len();
    let files: Vec<String> = walk.files.into_iter().skip(offset).take(limit).map(|(_, relative)| relative).collect();
    let end = offset.saturating_add(files.len());
    Ok(FileList { files, total, next_offset: (end < total).then_some(end), truncated: walk.truncated })
}

#[derive(Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    /// Treat `query` as a regular expression instead of literal text.
    pub regex: Option<bool>,
    /// Unset means smart case: case-insensitive unless the query has an uppercase letter.
    pub case_sensitive: Option<bool>,
    pub path: Option<String>,
    pub glob: Option<String>,
    pub context_lines: Option<usize>,
    pub max_results: Option<usize>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub text: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub before: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub after: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    /// Some matches were left out: the result cap, a per-file cap, or the walk limit was hit.
    pub truncated: bool,
    pub files_searched: usize,
}

fn search_pattern(options: &SearchOptions) -> Result<Regex, String> {
    let query = options.query.as_str();
    if query.is_empty() || query.len() > 500 {
        return Err("Search for 1 to 500 bytes of text.".into());
    }
    let source = if options.regex.unwrap_or(false) { query.to_string() } else { regex::escape(query) };
    let case_sensitive = options.case_sensitive.unwrap_or_else(|| query.chars().any(char::is_uppercase));
    RegexBuilder::new(&source)
        .case_insensitive(!case_sensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| format!("Invalid regular expression: {e}"))
}

fn clip(line: &str) -> String {
    line.chars().take(MAX_LINE_CHARS).collect()
}

/// Searches the workspace line by line, the way `rg` does: `.gitignore` is respected and binary
/// or very large files are skipped.
pub fn search_files(root: &Path, options: &SearchOptions) -> Result<SearchResult, String> {
    let pattern = search_pattern(options)?;
    let context = options.context_lines.unwrap_or(0).min(MAX_CONTEXT_LINES);
    let max_results = options.max_results.unwrap_or(DEFAULT_SEARCH_RESULTS).clamp(1, MAX_SEARCH_RESULTS);
    let walk = walk_workspace(root, options.path.as_deref(), options.glob.as_deref())?;
    let mut truncated = walk.truncated;
    let mut matches = Vec::new();
    let mut files_searched = 0;
    let mut bytes_read = 0_u64;
    for (absolute, relative) in walk.files {
        let Ok(metadata) = fs::metadata(&absolute) else { continue };
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        bytes_read += metadata.len();
        if bytes_read > MAX_SEARCH_BYTES {
            truncated = true;
            break;
        }
        let Ok(bytes) = fs::read(&absolute) else { continue };
        if bytes.iter().take(8192).any(|byte| *byte == 0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else { continue };
        files_searched += 1;
        let lines: Vec<&str> = content.lines().collect();
        let mut in_file = 0;
        for (index, line) in lines.iter().enumerate() {
            if !pattern.is_match(line) {
                continue;
            }
            if matches.len() >= max_results {
                return Ok(SearchResult { matches, truncated: true, files_searched });
            }
            if in_file >= MAX_MATCHES_PER_FILE {
                truncated = true;
                break;
            }
            in_file += 1;
            matches.push(SearchMatch {
                path: relative.clone(),
                line: index + 1,
                text: clip(line),
                before: lines[index.saturating_sub(context)..index].iter().map(|line| clip(line)).collect(),
                after: lines[index + 1..(index + 1 + context).min(lines.len())].iter().map(|line| clip(line)).collect(),
            });
        }
    }
    Ok(SearchResult { matches, truncated, files_searched })
}

#[cfg(test)]
mod tests;
