//! Reading diffs and commits with libgit2, and applying hunk patches to the index and the working
//! tree (Athas's `version-control` crate shells out to `git apply` for these; libgit2 applies the
//! same patches in process). Every function blocks; views call them off the UI thread.

// The web build keeps only the helpers that need no libgit2.
#![cfg_attr(target_family = "wasm", allow(unused_imports, dead_code))]

use std::{
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context as _, Result, anyhow, bail};
#[cfg(not(target_family = "wasm"))]
use git2::{ApplyLocation, Delta, Diff, DiffFindOptions, DiffOptions, Oid, Patch, Repository, Tree};

use crate::{
    model::{DiffLine, FileContent, FileDiff, FileStatus, Hunk, ImageSide, LineKind, MAX_LINES, hunk_patch},
    target::{DiffTarget, Scope},
};

/// Sides larger than this are not kept whole, so unchanged lines around them cannot unfold.
const MAX_TEXT_BYTES: usize = 1024 * 1024;

/// `path` (relative to the root) as it was at `commit`, as text (`git_file_at_commit`).
#[cfg(not(target_family = "wasm"))]
pub fn file_at_commit(root: &Path, commit: &str, path: &str) -> Result<String> {
    athas_version_control::git_file_at_commit(root.to_string_lossy().into_owned(), commit.to_string(), path.to_string()).map_err(|error| anyhow!(error))
}

#[cfg(not(target_family = "wasm"))]
pub fn open(root: &Path) -> Result<Repository> {
    Repository::open(root).with_context(|| format!("opening the repository at {}", root.display()))
}

#[cfg(not(target_family = "wasm"))]
/// The root of the working tree that contains `path`.
pub fn discover(path: &Path) -> Option<PathBuf> {
    let repo = Repository::discover(path).ok()?;
    repo.workdir().map(|dir| dir.to_path_buf())
}

pub fn is_image(path: &str) -> bool {
    image_format(path).is_some()
}

/// The format GPUI decodes an image path with.
pub fn image_format(path: &str) -> Option<gpui::ImageFormat> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => gpui::ImageFormat::Png,
        "jpg" | "jpeg" => gpui::ImageFormat::Jpeg,
        "gif" => gpui::ImageFormat::Gif,
        "webp" => gpui::ImageFormat::Webp,
        "svg" => gpui::ImageFormat::Svg,
        "bmp" => gpui::ImageFormat::Bmp,
        "tif" | "tiff" => gpui::ImageFormat::Tiff,
        "ico" => gpui::ImageFormat::Ico,
        _ => return None,
    })
}

#[cfg(not(target_family = "wasm"))]
fn head_tree(repo: &Repository) -> Option<Tree<'_>> {
    repo.head().ok()?.peel_to_tree().ok()
}

#[cfg(not(target_family = "wasm"))]
fn commit_tree<'r>(repo: &'r Repository, rev: &str) -> Result<git2::Commit<'r>> {
    repo.revparse_single(rev)
        .and_then(|object| object.peel_to_commit())
        .with_context(|| format!("finding {rev}"))
}

#[cfg(not(target_family = "wasm"))]
fn parent_tree<'r>(commit: &git2::Commit<'r>) -> Result<Option<Tree<'r>>> {
    Ok(match commit.parent_count() {
        0 => None,
        _ => Some(commit.parent(0)?.tree()?),
    })
}

#[cfg(not(target_family = "wasm"))]
/// Where the new side of a diff lives: in the object database or on disk.
#[derive(Clone, Copy, PartialEq, Eq)]
enum NewSide {
    Objects,
    WorkingTree,
}

#[cfg(not(target_family = "wasm"))]
fn find_renames(diff: &mut Diff) -> Result<()> {
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
/// The files `target` changes, in the order git lists them.
pub fn load(root: &Path, target: &DiffTarget) -> Result<Vec<FileDiff>> {
    if let DiffTarget::Files { path, old, new, .. } = target {
        return load_files(path, Path::new(old), Path::new(new)).map(|file| vec![file]);
    }
    if let DiffTarget::FileSet { key, .. } = target {
        return load_file_set(key);
    }
    let repo = open(root)?;
    let single = |path: &str| {
        let mut options = DiffOptions::new();
        options.pathspec(path).disable_pathspec_match(true);
        options
    };
    match target {
        DiffTarget::Working { path } => {
            let index = repo.index()?;
            let mut options = single(path);
            options.include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true);
            let diff = repo.diff_index_to_workdir(Some(&index), Some(&mut options))?;
            files(&repo, &diff, NewSide::WorkingTree, None)
        }
        DiffTarget::Staged { path } => {
            let index = repo.index()?;
            let diff = repo.diff_tree_to_index(head_tree(&repo).as_ref(), Some(&index), Some(&mut single(path)))?;
            files(&repo, &diff, NewSide::Objects, None)
        }
        DiffTarget::CommitFile { commit, path } => {
            let commit = commit_tree(&repo, commit)?;
            let mut diff = repo.diff_tree_to_tree(parent_tree(&commit)?.as_ref(), Some(&commit.tree()?), None)?;
            find_renames(&mut diff)?;
            files(&repo, &diff, NewSide::Objects, Some(path))
        }
        DiffTarget::Commit { commit } => {
            let commit = commit_tree(&repo, commit)?;
            let mut diff = repo.diff_tree_to_tree(parent_tree(&commit)?.as_ref(), Some(&commit.tree()?), None)?;
            find_renames(&mut diff)?;
            files(&repo, &diff, NewSide::Objects, None)
        }
        DiffTarget::Stash { index } => {
            let stash = commit_tree(&repo, &format!("stash@{{{index}}}"))?;
            let diff = repo.diff_tree_to_tree(parent_tree(&stash)?.as_ref(), Some(&stash.tree()?), None)?;
            let mut out = files(&repo, &diff, NewSide::Objects, None)?;
            // `git stash -u` keeps untracked files in a third parent.
            if stash.parent_count() > 2 {
                let untracked = stash.parent(2)?.tree()?;
                let diff = repo.diff_tree_to_tree(None, Some(&untracked), None)?;
                out.extend(files(&repo, &diff, NewSide::Objects, None)?);
            }
            Ok(out)
        }
        DiffTarget::Compare { base, target } => {
            let base = commit_tree(&repo, base)?.tree()?;
            let target = commit_tree(&repo, target)?.tree()?;
            let mut diff = repo.diff_tree_to_tree(Some(&base), Some(&target), None)?;
            find_renames(&mut diff)?;
            files(&repo, &diff, NewSide::Objects, None)
        }
        DiffTarget::WorkingTree { scope } => Ok(load_working_tree(root, *scope)?.into_iter().map(|(_, file)| file).collect()),
        DiffTarget::Files { .. } | DiffTarget::FileSet { .. } => unreachable!(),
    }
}

#[cfg(not(target_family = "wasm"))]
/// The files of an in-memory set ([`crate::register_file_set`]), each diffed as two buffers.
pub fn load_file_set(key: &str) -> Result<Vec<FileDiff>> {
    let files = crate::file_set(key).ok_or_else(|| anyhow!("These changes are no longer available."))?;
    files
        .iter()
        .map(|file| {
            let path = file.path.to_string_lossy();
            let mut diff = diff_buffers(&path, file.old.as_bytes().to_vec(), file.new.as_bytes().to_vec())?;
            diff.status = match (file.old.is_empty(), file.new.is_empty()) {
                (true, false) => FileStatus::Added,
                (false, true) => FileStatus::Deleted,
                _ => FileStatus::Modified,
            };
            Ok(diff)
        })
        .collect()
}

#[cfg(not(target_family = "wasm"))]
/// Two files on disk compared without a repository, shown as `path`.
pub fn load_files(path: &str, old: &Path, new: &Path) -> Result<FileDiff> {
    let old_bytes = std::fs::read(old).with_context(|| format!("reading {}", old.display()))?;
    let new_bytes = std::fs::read(new).with_context(|| format!("reading {}", new.display()))?;
    diff_buffers(path, old_bytes, new_bytes)
}

#[cfg(not(target_family = "wasm"))]
/// Two versions of a file compared as buffers, shown as `path`.
fn diff_buffers(path: &str, old_bytes: Vec<u8>, new_bytes: Vec<u8>) -> Result<FileDiff> {
    let mut file = FileDiff {
        old_path: None,
        path: path.replace('\\', "/"),
        status: FileStatus::Modified,
        content: FileContent::Binary,
        additions: 0,
        deletions: 0,
        truncated: false,
    };
    if is_image(path) {
        file.content = FileContent::Image { old: image_side(Some(old_bytes)), new: image_side(Some(new_bytes)) };
        return Ok(file);
    }
    let patch = Patch::from_buffers(&old_bytes, Some(Path::new(path)), &new_bytes, Some(Path::new(path)), None)?;
    if patch.delta().flags().is_binary() {
        return Ok(file);
    }
    let mut budget = MAX_LINES;
    let hunks = patch_hunks(&patch, &mut file, &mut budget)?;
    drop(patch);
    file.content = FileContent::Text { hunks, old_text: text_lines(Some(old_bytes)), new_text: text_lines(Some(new_bytes)) };
    Ok(file)
}

#[cfg(not(target_family = "wasm"))]
/// Every tracked file with changes in `scope`, each with whether it is the staged side; by path,
/// a file's staged side before its unstaged one (`working-tree-multi-diff`).
pub fn load_working_tree(root: &Path, scope: Scope) -> Result<Vec<(bool, FileDiff)>> {
    let repo = open(root)?;
    let index = repo.index()?;
    let mut out = Vec::new();
    if scope.includes(true) {
        let diff = repo.diff_tree_to_index(head_tree(&repo).as_ref(), Some(&index), None)?;
        out.extend(files(&repo, &diff, NewSide::Objects, None)?.into_iter().map(|file| (true, file)));
    }
    if scope.includes(false) {
        let diff = repo.diff_index_to_workdir(Some(&index), None)?;
        out.extend(files(&repo, &diff, NewSide::WorkingTree, None)?.into_iter().map(|file| (false, file)));
    }
    out.sort_by(|a, b| a.1.path.cmp(&b.1.path).then(b.0.cmp(&a.0)));
    Ok(out)
}

#[cfg(not(target_family = "wasm"))]
/// The GitHub page of what a commit or comparison diff shows, from the `origin` remote (else the
/// first one), when it is on GitHub.
pub fn github_url(root: &Path, target: &DiffTarget) -> Option<String> {
    let reference = github_reference(target)?;
    let repo = open(root).ok()?;
    let url = |name: &str| repo.find_remote(name).ok().and_then(|remote| remote.url().map(str::to_string));
    let remote = url("origin").or_else(|| repo.remotes().ok()?.iter().flatten().find_map(url))?;
    github_reference_url(&remote, &reference)
}

fn github_reference(target: &DiffTarget) -> Option<String> {
    match target {
        DiffTarget::Commit { commit } => Some(commit.clone()),
        DiffTarget::Compare { base, target } => Some(format!("{base}..{target}")),
        _ => None,
    }
}

/// `owner` and `repo` of a GitHub remote URL (https or ssh).
fn github_slug(remote: &str) -> Option<(String, String)> {
    let remote = remote.trim();
    let rest = remote
        .strip_prefix("https://github.com/")
        .or_else(|| remote.strip_prefix("http://github.com/"))
        .or_else(|| remote.strip_prefix("git@github.com:"))?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, repo) = rest.split_once('/')?;
    (!owner.is_empty() && !repo.is_empty() && !repo.contains('/')).then(|| (owner.to_string(), repo.to_string()))
}

fn encode_component(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// The GitHub URL of a commit, or of a `base..target` (or `...`) comparison.
pub fn github_reference_url(remote: &str, reference: &str) -> Option<String> {
    let (owner, repo) = github_slug(remote)?;
    let comparison = reference.split_once("...").or_else(|| reference.split_once(".."));
    Some(match comparison {
        Some((base, target)) if !base.is_empty() && !target.is_empty() => {
            format!("https://github.com/{owner}/{repo}/compare/{}...{}", encode_component(base), encode_component(target.trim_start_matches('.')))
        }
        _ => format!("https://github.com/{owner}/{repo}/commit/{}", encode_component(reference)),
    })
}

#[cfg(not(target_family = "wasm"))]
fn delta_path(file: git2::DiffFile<'_>) -> Option<String> {
    file.path().map(|path| path.to_string_lossy().replace('\\', "/"))
}

#[cfg(not(target_family = "wasm"))]
fn blob_bytes(repo: &Repository, oid: Oid) -> Option<Vec<u8>> {
    (!oid.is_zero()).then(|| repo.find_blob(oid).ok().map(|blob| blob.content().to_vec())).flatten()
}

#[cfg(not(target_family = "wasm"))]
fn text_lines(bytes: Option<Vec<u8>>) -> Option<Arc<Vec<String>>> {
    let bytes = bytes?;
    if bytes.len() > MAX_TEXT_BYTES || bytes.contains(&0) {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    Some(Arc::new(text.lines().map(str::to_string).collect()))
}

#[cfg(not(target_family = "wasm"))]
fn image_side(bytes: Option<Vec<u8>>) -> Option<ImageSide> {
    let bytes = bytes?;
    let size = image::ImageReader::new(Cursor::new(&bytes)).with_guessed_format().ok().and_then(|reader| reader.into_dimensions().ok());
    Some(ImageSide { bytes: Arc::new(bytes), size })
}

#[cfg(not(target_family = "wasm"))]
fn files(repo: &Repository, diff: &Diff, new_side: NewSide, only: Option<&str>) -> Result<Vec<FileDiff>> {
    let root = repo.workdir().map(Path::to_path_buf);
    let mut out = Vec::new();
    let mut budget = MAX_LINES;
    for index in 0..diff.deltas().len() {
        let Some(delta) = diff.get_delta(index) else { continue };
        let status = match delta.status() {
            Delta::Added | Delta::Untracked => FileStatus::Added,
            Delta::Deleted => FileStatus::Deleted,
            Delta::Renamed | Delta::Copied => FileStatus::Renamed,
            Delta::Modified | Delta::Typechange => FileStatus::Modified,
            _ => continue,
        };
        let old_path = delta_path(delta.old_file());
        let new_path = delta_path(delta.new_file());
        let path = match status {
            FileStatus::Deleted => old_path.clone(),
            _ => new_path.clone().or_else(|| old_path.clone()),
        }
        .unwrap_or_default();
        if let Some(only) = only
            && path != only
            && old_path.as_deref() != Some(only)
        {
            continue;
        }

        let old_bytes = || blob_bytes(repo, delta.old_file().id());
        let new_bytes = || match (new_side, &root, status) {
            (_, _, FileStatus::Deleted) => None,
            (NewSide::WorkingTree, Some(root), _) => std::fs::read(root.join(&path)).ok(),
            _ => blob_bytes(repo, delta.new_file().id()),
        };

        let mut file = FileDiff {
            old_path: (status == FileStatus::Renamed).then(|| old_path.clone()).flatten(),
            path: path.clone(),
            status,
            content: FileContent::Binary,
            additions: 0,
            deletions: 0,
            truncated: false,
        };
        if is_image(&path) {
            file.content = FileContent::Image { old: image_side(old_bytes()), new: image_side(new_bytes()) };
            out.push(file);
            continue;
        }
        let patch = Patch::from_diff(diff, index)?;
        let binary = patch.as_ref().map_or(delta.flags().is_binary(), |patch| patch.delta().flags().is_binary());
        if binary {
            out.push(file);
            continue;
        }
        let hunks = match &patch {
            Some(patch) => patch_hunks(patch, &mut file, &mut budget)?,
            None => Vec::new(),
        };
        file.content = FileContent::Text { hunks, old_text: text_lines(old_bytes()), new_text: text_lines(new_bytes()) };
        out.push(file);
    }
    Ok(out)
}

#[cfg(not(target_family = "wasm"))]
/// A patch's hunks as diff lines, counting additions and deletions into `file` and stopping
/// once `budget` lines are used.
fn patch_hunks(patch: &Patch<'_>, file: &mut FileDiff, budget: &mut usize) -> Result<Vec<Hunk>> {
    let mut hunks = Vec::new();
    'hunks: for hunk_index in 0..patch.num_hunks() {
        let (hunk, line_count) = patch.hunk(hunk_index)?;
        let mut lines = Vec::with_capacity(line_count);
        for line_index in 0..line_count {
            if *budget == 0 {
                file.truncated = true;
                if !lines.is_empty() {
                    hunks.push(make_hunk(&hunk, lines));
                }
                break 'hunks;
            }
            *budget -= 1;
            let line = patch.line_in_hunk(hunk_index, line_index)?;
            let kind = match line.origin() {
                ' ' => LineKind::Context,
                '+' => LineKind::Added,
                '-' => LineKind::Removed,
                '=' | '>' | '<' => LineKind::NoNewline,
                _ => continue,
            };
            let content = String::from_utf8_lossy(line.content());
            let text = if kind == LineKind::NoNewline { String::new() } else { content.strip_suffix('\n').unwrap_or(&content).to_string() };
            match kind {
                LineKind::Added => file.additions += 1,
                LineKind::Removed => file.deletions += 1,
                _ => {}
            }
            lines.push(DiffLine { kind, old: line.old_lineno(), new: line.new_lineno(), text });
        }
        hunks.push(make_hunk(&hunk, lines));
    }
    Ok(hunks)
}

#[cfg(not(target_family = "wasm"))]
fn make_hunk(hunk: &git2::DiffHunk<'_>, lines: Vec<DiffLine>) -> Hunk {
    let header = String::from_utf8_lossy(hunk.header()).trim_end().to_string();
    Hunk {
        header,
        old_start: hunk.old_start(),
        old_lines: hunk.old_lines(),
        new_start: hunk.new_start(),
        new_lines: hunk.new_lines(),
        lines,
    }
}

// Hunk actions.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HunkAction {
    /// Working tree hunk into the index.
    Stage,
    /// Staged hunk back out of the index.
    Unstage,
    /// Working tree hunk thrown away.
    Discard,
}

impl HunkAction {
    pub fn label(self) -> &'static str {
        match self {
            HunkAction::Stage => "stage",
            HunkAction::Unstage => "unstage",
            HunkAction::Discard => "discard",
        }
    }
}

/// Whether `action` makes sense for a hunk of `file` shown as `target`.
pub fn allows(target: &DiffTarget, file: &FileDiff, action: HunkAction) -> bool {
    match (target, action) {
        (DiffTarget::Working { .. }, HunkAction::Stage) => true,
        // An untracked file has nothing to go back to.
        (DiffTarget::Working { .. }, HunkAction::Discard) => file.status != FileStatus::Added,
        (DiffTarget::Staged { .. }, HunkAction::Unstage) => true,
        _ => false,
    }
}

#[cfg(not(target_family = "wasm"))]
/// Applies `action` to one hunk of `file`. A file added or deleted as a whole has a single hunk,
/// so it is staged, unstaged or restored as a whole.
pub fn apply_hunk(root: &Path, file: &FileDiff, hunk: &Hunk, action: HunkAction) -> Result<()> {
    let repo = open(root)?;
    let path = file.path.as_str();
    if file.status != FileStatus::Modified {
        return apply_whole_file(&repo, file, action);
    }
    let (reverse, location) = match action {
        HunkAction::Stage => (false, ApplyLocation::Index),
        HunkAction::Unstage => (true, ApplyLocation::Index),
        HunkAction::Discard => (true, ApplyLocation::WorkDir),
    };
    if let Some(reason) = hunk.unpatchable() {
        bail!("{reason}");
    }
    let patch = hunk_patch(path, hunk, reverse);
    let diff = Diff::from_buffer(patch.as_bytes()).context("reading the hunk patch")?;
    repo.apply(&diff, location, None)
        .map_err(|error| anyhow!("Failed to {} hunk: {}", action.label(), error.message()))
}

#[cfg(not(target_family = "wasm"))]
fn apply_whole_file(repo: &Repository, file: &FileDiff, action: HunkAction) -> Result<()> {
    let path = Path::new(&file.path);
    match action {
        HunkAction::Stage => {
            let mut index = repo.index()?;
            if file.status == FileStatus::Deleted {
                index.remove_path(path)?;
            } else {
                index.add_path(path)?;
            }
            index.write()?;
        }
        HunkAction::Unstage => {
            let head = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
            match head {
                Some(head) => repo.reset_default(Some(head.as_object()), [path])?,
                None => {
                    let mut index = repo.index()?;
                    index.remove_path(path)?;
                    index.write()?;
                }
            }
        }
        HunkAction::Discard => {
            if file.status == FileStatus::Added {
                bail!("An untracked file has no committed version to go back to");
            }
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.path(path).force();
            repo.checkout_index(None, Some(&mut checkout))?;
        }
    }
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
/// Stages or unstages a whole file, as the diff header's button does.
pub fn set_file_staged(root: &Path, file: &FileDiff, staged: bool) -> Result<()> {
    let repo = open(root)?;
    apply_whole_file(&repo, file, if staged { HunkAction::Stage } else { HunkAction::Unstage })
}

// Commits.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Person {
    pub name: String,
    pub email: String,
    /// Seconds since the epoch, and the offset from UTC in minutes it was written in.
    pub time: i64,
    pub offset_minutes: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitDetails {
    pub hash: String,
    pub summary: String,
    /// The message after the summary line, trimmed.
    pub body: String,
    pub author: Person,
    pub committer: Person,
    pub parents: Vec<String>,
    pub files: Vec<ChangedFile>,
}

impl CommitDetails {
    pub fn totals(&self) -> (usize, usize) {
        self.files.iter().fold((0, 0), |(added, removed), file| (added + file.additions, removed + file.deletions))
    }
}

#[cfg(not(target_family = "wasm"))]
fn person(signature: git2::Signature<'_>) -> Person {
    Person {
        name: String::from_utf8_lossy(signature.name_bytes()).into_owned(),
        email: String::from_utf8_lossy(signature.email_bytes()).into_owned(),
        time: signature.when().seconds(),
        offset_minutes: signature.when().offset_minutes(),
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn commit_details(root: &Path, rev: &str) -> Result<CommitDetails> {
    let repo = open(root)?;
    let commit = commit_tree(&repo, rev)?;
    let message = String::from_utf8_lossy(commit.message_bytes()).into_owned();
    let (summary, body) = match message.trim().split_once('\n') {
        Some((summary, body)) => (summary.trim().to_string(), body.trim().to_string()),
        None => (message.trim().to_string(), String::new()),
    };
    let mut diff = repo.diff_tree_to_tree(parent_tree(&commit)?.as_ref(), Some(&commit.tree()?), None)?;
    find_renames(&mut diff)?;
    let mut files = Vec::new();
    for index in 0..diff.deltas().len() {
        let Some(delta) = diff.get_delta(index) else { continue };
        let status = match delta.status() {
            Delta::Added => FileStatus::Added,
            Delta::Deleted => FileStatus::Deleted,
            Delta::Renamed | Delta::Copied => FileStatus::Renamed,
            Delta::Modified | Delta::Typechange => FileStatus::Modified,
            _ => continue,
        };
        let old_path = delta_path(delta.old_file());
        let path = if status == FileStatus::Deleted { old_path.clone() } else { delta_path(delta.new_file()) }.unwrap_or_default();
        let patch = Patch::from_diff(&diff, index)?;
        let binary = patch.as_ref().map_or(delta.flags().is_binary(), |patch| patch.delta().flags().is_binary());
        let (_, additions, deletions) = match &patch {
            Some(patch) if !binary => patch.line_stats()?,
            _ => (0, 0, 0),
        };
        files.push(ChangedFile {
            old_path: (status == FileStatus::Renamed).then_some(old_path).flatten(),
            path,
            status,
            additions,
            deletions,
            binary,
        });
    }
    Ok(CommitDetails {
        hash: commit.id().to_string(),
        summary,
        body,
        author: person(commit.author()),
        committer: person(commit.committer()),
        parents: commit.parent_ids().map(|id| id.to_string()).collect(),
        files,
    })
}

/// `YYYY-MM-DD HH:MM` in the time zone the date was written in.
pub fn format_time(time: i64, offset_minutes: i32) -> String {
    let local = time + offset_minutes as i64 * 60;
    let (days, seconds) = (local.div_euclid(86_400), local.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}", seconds / 3600, seconds % 3600 / 60)
}

/// The date of a day count since 1970-01-01, proleptic Gregorian.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// "just now", "5 minutes ago", "3 days ago", then the date: how blame and commits say when.
pub fn relative_time(time: i64, now: i64) -> String {
    let elapsed = (now - time).max(0);
    let unit = |count: i64, word: &str| format!("{count} {word}{} ago", if count == 1 { "" } else { "s" });
    match elapsed {
        0..60 => "just now".into(),
        60..3600 => unit(elapsed / 60, "minute"),
        3600..86_400 => unit(elapsed / 3600, "hour"),
        86_400..2_592_000 => unit(elapsed / 86_400, "day"),
        2_592_000..31_536_000 => unit(elapsed / 2_592_000, "month"),
        _ => unit(elapsed / 31_536_000, "year"),
    }
}

pub fn now() -> i64 {
    web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs() as i64)
}


/// The web build has no libgit2: its repository lives on the workspace server
/// ([`crate::remote`]).
#[cfg(target_family = "wasm")]
mod web {
    use super::*;
    use crate::remote::{RemoteRepository, remote};

    fn repository(root: &Path) -> Result<&'static Arc<dyn RemoteRepository>> {
        remote().filter(|remote| remote.root() == root).ok_or_else(|| anyhow!("{} is not the workspace's repository", root.display()))
    }

    pub fn discover(path: &Path) -> Option<PathBuf> {
        remote().filter(|remote| path.starts_with(remote.root())).map(|remote| remote.root().to_path_buf())
    }

    pub fn load(root: &Path, target: &DiffTarget) -> Result<Vec<FileDiff>> {
        if let DiffTarget::FileSet { key, .. } = target {
            return load_file_set(key);
        }
        repository(root)?.load(target)
    }

    /// The files of an in-memory set, diffed in the browser by [`crate::line_diff`].
    pub fn load_file_set(key: &str) -> Result<Vec<FileDiff>> {
        let files = crate::file_set(key).ok_or_else(|| anyhow!("These changes are no longer available."))?;
        Ok(files
            .iter()
            .map(|file| {
                let mut diff = crate::line_diff::diff_texts(&file.path.to_string_lossy(), &file.old, &file.new);
                diff.status = match (file.old.is_empty(), file.new.is_empty()) {
                    (true, false) => FileStatus::Added,
                    (false, true) => FileStatus::Deleted,
                    _ => FileStatus::Modified,
                };
                diff
            })
            .collect())
    }

    pub fn apply_hunk(root: &Path, file: &FileDiff, hunk: &Hunk, action: HunkAction) -> Result<()> {
        repository(root)?.apply_hunk(file, hunk, action)
    }

    pub fn set_file_staged(root: &Path, file: &FileDiff, staged: bool) -> Result<()> {
        repository(root)?.set_file_staged(file, staged)
    }

    pub fn commit_details(root: &Path, rev: &str) -> Result<CommitDetails> {
        repository(root)?.commit_details(rev)
    }

    pub fn file_at_commit(root: &Path, commit: &str, path: &str) -> Result<String> {
        repository(root)?.file_at_commit(commit, path)
    }

    pub fn load_working_tree(_: &Path, _: Scope) -> Result<Vec<(bool, FileDiff)>> {
        bail!("Not available on the web")
    }

    pub fn github_url(_: &Path, _: &DiffTarget) -> Option<String> {
        None
    }
}

#[cfg(target_family = "wasm")]
pub use web::*;

#[cfg(test)]
pub(crate) mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn diffs_files_held_in_memory() {
        let files = vec![
            crate::MemoryFile { path: "src/a.rs".into(), old: "one\ntwo\n".into(), new: "one\n2\n".into() },
            crate::MemoryFile { path: "src/new.rs".into(), old: String::new(), new: "fn main() {}\n".into() },
        ];
        let target = crate::register_file_set("test-step", "Agent step", files);
        assert_eq!(DiffTarget::parse(&target.format()), Some(target.clone()));
        let diffs = load(Path::new("/nowhere"), &target).unwrap();
        assert_eq!(diffs.iter().map(|file| (file.path.as_str(), file.status, file.additions, file.deletions)).collect::<Vec<_>>(), [
            ("src/a.rs", FileStatus::Modified, 1, 1),
            ("src/new.rs", FileStatus::Added, 1, 0),
        ]);
        assert!(load(Path::new("/nowhere"), &DiffTarget::FileSet { key: "missing".into(), title: String::new() }).is_err());
    }

    #[test]
    fn compares_two_files_outside_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        let (old, new) = (dir.path().join("old"), dir.path().join("new"));
        fs::write(&old, "one\ntwo\nthree\n").unwrap();
        fs::write(&new, "one\n2\nthree\nfour\n").unwrap();
        let target = DiffTarget::Files { title: "a.txt: Earlier vs Current".into(), path: "/p/a.txt".into(), old: old.to_string_lossy().into(), new: new.to_string_lossy().into() };
        let files = load(dir.path(), &target).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!((files[0].path.as_str(), files[0].additions, files[0].deletions), ("/p/a.txt", 2, 1));
    }

    #[test]
    fn reads_a_file_as_it_was_at_a_commit() {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        let first = commit_all(&repo, "First");
        fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        fs::write(dir.path().join("b.bin"), [0xff, 0xfe, 0x00]).unwrap();
        commit_all(&repo, "Second");
        assert_eq!(file_at_commit(dir.path(), &first.to_string(), "a.txt").unwrap(), "one\n");
        assert_eq!(file_at_commit(dir.path(), "HEAD", "a.txt").unwrap(), "two\n");
        assert!(file_at_commit(dir.path(), &first.to_string(), "b.bin").is_err());
        let backend = crate::commit_file::CommitFile { repo: dir.path().to_path_buf(), commit: "HEAD".into(), path: "b.bin".into() };
        assert!(matches!(editor::FileBackend::load(&backend, Path::new("b.bin")).unwrap(), editor::Loaded::Binary));
        assert!(editor::FileBackend::save(&backend, Path::new("a.txt"), "x").is_err());
        assert_eq!(crate::commit_file::title(&first.to_string(), "src/a.txt"), format!("a.txt ({})", &first.to_string()[..7]));
    }

    /// A throwaway repository; nothing here touches a real one.
    pub(crate) fn scratch() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("init");
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Ada").unwrap();
            config.set_str("user.email", "ada@example.com").unwrap();
        }
        (dir, repo)
    }

    pub(crate) fn commit_all(repo: &Repository, message: &str) -> Oid {
        let mut index = repo.index().unwrap();
        index.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
        index.update_all(["*"], None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = repo.signature().unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok().and_then(|head| head.peel_to_commit().ok()).into_iter().collect();
        let parents: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &parents).unwrap()
    }

    fn numbered(lines: std::ops::RangeInclusive<u32>) -> String {
        lines.map(|n| format!("line {n}\n")).collect()
    }

    fn read(dir: &tempfile::TempDir, path: &str) -> String {
        fs::read_to_string(dir.path().join(path)).unwrap()
    }

    fn index_text(repo: &Repository, path: &str) -> String {
        let mut index = repo.index().unwrap();
        index.read(true).unwrap();
        let entry = index.get_path(Path::new(path), 0).unwrap();
        String::from_utf8(repo.find_blob(entry.id).unwrap().content().to_vec()).unwrap()
    }

    /// `a.txt` with 30 lines committed, then lines 2 and 25 changed in the working tree: two hunks.
    fn two_hunks() -> (tempfile::TempDir, Repository) {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("a.txt"), numbered(1..=30)).unwrap();
        commit_all(&repo, "First");
        let changed = numbered(1..=30).replace("line 2\n", "line two\n").replace("line 25\n", "line 25\nextra\n");
        fs::write(dir.path().join("a.txt"), changed).unwrap();
        (dir, repo)
    }

    #[test]
    fn reads_working_and_staged_diffs() {
        let (dir, _repo) = two_hunks();
        let files = load(dir.path(), &DiffTarget::Working { path: "a.txt".into() }).unwrap();
        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!((file.status, file.additions, file.deletions), (FileStatus::Modified, 2, 1));
        assert_eq!(file.hunks().len(), 2);
        assert_eq!(file.hunks()[0].header, "@@ -1,5 +1,5 @@");
        let FileContent::Text { old_text, new_text, .. } = &file.content else { panic!() };
        assert_eq!(old_text.as_ref().unwrap().len(), 30);
        assert_eq!(new_text.as_ref().unwrap().len(), 31);
        assert!(load(dir.path(), &DiffTarget::Staged { path: "a.txt".into() }).unwrap().is_empty());
    }

    #[test]
    fn stages_unstages_and_discards_single_hunks() {
        let (dir, repo) = two_hunks();
        let working = |dir: &tempfile::TempDir| load(dir.path(), &DiffTarget::Working { path: "a.txt".into() }).unwrap().remove(0);
        let staged = |dir: &tempfile::TempDir| load(dir.path(), &DiffTarget::Staged { path: "a.txt".into() }).unwrap();

        let file = working(&dir);
        apply_hunk(dir.path(), &file, &file.hunks()[1], HunkAction::Stage).unwrap();
        assert!(index_text(&repo, "a.txt").contains("line 25\nextra\n"));
        assert!(index_text(&repo, "a.txt").contains("line 2\n"), "the first hunk stays unstaged");
        let file = working(&dir);
        assert_eq!(file.hunks().len(), 1);
        assert_eq!(staged(&dir)[0].hunks().len(), 1);

        let staged_file = staged(&dir).remove(0);
        apply_hunk(dir.path(), &staged_file, &staged_file.hunks()[0], HunkAction::Unstage).unwrap();
        assert!(staged(&dir).is_empty());
        assert_eq!(working(&dir).hunks().len(), 2);

        let file = working(&dir);
        apply_hunk(dir.path(), &file, &file.hunks()[0], HunkAction::Discard).unwrap();
        let text = read(&dir, "a.txt");
        assert!(text.contains("line 2\n") && !text.contains("line two"), "first hunk thrown away");
        assert!(text.contains("extra\n"), "second hunk kept");
    }

    #[test]
    fn whole_file_hunks_for_new_and_deleted_files() {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("keep.txt"), "keep\n").unwrap();
        commit_all(&repo, "First");
        fs::write(dir.path().join("new.txt"), "one\ntwo\n").unwrap();
        let file = load(dir.path(), &DiffTarget::Working { path: "new.txt".into() }).unwrap().remove(0);
        assert_eq!((file.status, file.additions), (FileStatus::Added, 2));
        assert!(!allows(&DiffTarget::Working { path: "new.txt".into() }, &file, HunkAction::Discard));
        apply_hunk(dir.path(), &file, &file.hunks()[0], HunkAction::Stage).unwrap();
        assert_eq!(index_text(&repo, "new.txt"), "one\ntwo\n");
        let staged = load(dir.path(), &DiffTarget::Staged { path: "new.txt".into() }).unwrap().remove(0);
        apply_hunk(dir.path(), &staged, &staged.hunks()[0], HunkAction::Unstage).unwrap();
        let mut index = repo.index().unwrap();
        index.read(true).unwrap();
        assert!(index.get_path(Path::new("new.txt"), 0).is_none());

        fs::remove_file(dir.path().join("keep.txt")).unwrap();
        let file = load(dir.path(), &DiffTarget::Working { path: "keep.txt".into() }).unwrap().remove(0);
        assert_eq!(file.status, FileStatus::Deleted);
        apply_hunk(dir.path(), &file, &file.hunks()[0], HunkAction::Discard).unwrap();
        assert_eq!(read(&dir, "keep.txt"), "keep\n");
    }

    #[test]
    fn keeps_missing_final_newlines_when_patching() {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("a.txt"), "one\ntwo").unwrap();
        commit_all(&repo, "First");
        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree").unwrap();
        let file = load(dir.path(), &DiffTarget::Working { path: "a.txt".into() }).unwrap().remove(0);
        assert!(file.hunks()[0].lines.iter().any(|line| line.kind == LineKind::NoNewline));
        apply_hunk(dir.path(), &file, &file.hunks()[0], HunkAction::Stage).unwrap();
        assert_eq!(index_text(&repo, "a.txt"), "one\ntwo\nthree");
        let file = load(dir.path(), &DiffTarget::Working { path: "a.txt".into() }).unwrap();
        assert!(file.is_empty());
    }

    #[test]
    fn reads_commits_stashes_and_comparisons() {
        let (dir, mut repo) = scratch();
        fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        fs::write(dir.path().join("old.txt"), numbered(1..=20)).unwrap();
        let first = commit_all(&repo, "First");
        fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        fs::rename(dir.path().join("old.txt"), dir.path().join("new.txt")).unwrap();
        fs::write(dir.path().join("pic.png"), [0x89, b'P', b'N', b'G']).unwrap();
        let second = commit_all(&repo, "Second\n\nA longer body.");

        let details = commit_details(dir.path(), &second.to_string()).unwrap();
        assert_eq!(details.summary, "Second");
        assert_eq!(details.body, "A longer body.");
        assert_eq!(details.parents, vec![first.to_string()]);
        assert_eq!(details.author.name, "Ada");
        let summary: Vec<_> = details.files.iter().map(|file| (file.path.as_str(), file.status)).collect();
        assert_eq!(summary, [("a.txt", FileStatus::Modified), ("new.txt", FileStatus::Renamed), ("pic.png", FileStatus::Added)]);
        assert_eq!(details.files[1].old_path.as_deref(), Some("old.txt"));
        assert_eq!((details.files[0].additions, details.files[0].deletions), (1, 0));

        let whole = load(dir.path(), &DiffTarget::Commit { commit: second.to_string() }).unwrap();
        assert_eq!(whole.len(), 3);
        assert!(matches!(whole[2].content, FileContent::Image { old: None, new: Some(_) }));
        let one = load(dir.path(), &DiffTarget::CommitFile { commit: second.to_string(), path: "new.txt".into() }).unwrap();
        assert_eq!((one.len(), one[0].status), (1, FileStatus::Renamed));

        let compare = load(dir.path(), &DiffTarget::Compare { base: first.to_string(), target: "HEAD".into() }).unwrap();
        assert_eq!(compare.len(), 3);

        fs::write(dir.path().join("a.txt"), "changed\n").unwrap();
        fs::write(dir.path().join("untracked.txt"), "u\n").unwrap();
        let signature = repo.signature().unwrap();
        repo.stash_save(&signature, "wip", Some(git2::StashFlags::INCLUDE_UNTRACKED)).unwrap();
        let stash = load(dir.path(), &DiffTarget::Stash { index: 0 }).unwrap();
        let paths: Vec<_> = stash.iter().map(|file| (file.path.as_str(), file.status)).collect();
        assert_eq!(paths, [("a.txt", FileStatus::Modified), ("untracked.txt", FileStatus::Added)]);
    }

    #[test]
    fn reads_every_working_tree_change_by_scope() {
        let (dir, repo) = two_hunks();
        fs::write(dir.path().join("b.txt"), "b\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("b.txt")).unwrap();
        index.write().unwrap();
        fs::write(dir.path().join("b.txt"), "b\nmore\n").unwrap();
        fs::write(dir.path().join("untracked.txt"), "u\n").unwrap();
        let sides = |scope| load_working_tree(dir.path(), scope).unwrap().into_iter().map(|(staged, file)| (staged, file.path)).collect::<Vec<_>>();
        assert_eq!(sides(Scope::All), [(false, "a.txt".to_string()), (true, "b.txt".to_string()), (false, "b.txt".to_string())]);
        assert_eq!(sides(Scope::Staged), [(true, "b.txt".to_string())]);
        assert_eq!(sides(Scope::Unstaged), [(false, "a.txt".to_string()), (false, "b.txt".to_string())]);
        assert_eq!(load(dir.path(), &DiffTarget::WorkingTree { scope: Scope::All }).unwrap().len(), 3);
    }

    #[test]
    fn links_commits_and_comparisons_on_github() {
        let (dir, repo) = scratch();
        assert_eq!(github_url(dir.path(), &DiffTarget::Commit { commit: "abc".into() }), None);
        repo.remote("upstream", "git@github.com:athasdev/athas.git").unwrap();
        assert_eq!(github_url(dir.path(), &DiffTarget::Commit { commit: "abc".into() }).as_deref(), Some("https://github.com/athasdev/athas/commit/abc"));
        repo.remote("origin", "https://github.com/me/fork").unwrap();
        assert_eq!(
            github_url(dir.path(), &DiffTarget::Compare { base: "main".into(), target: "feature/x".into() }).as_deref(),
            Some("https://github.com/me/fork/compare/main...feature%2Fx")
        );
        assert_eq!(github_url(dir.path(), &DiffTarget::Stash { index: 0 }), None);
        assert_eq!(github_reference_url("https://gitlab.com/a/b.git", "abc"), None);
    }

    #[test]
    fn marks_binary_files() {
        let (dir, repo) = scratch();
        fs::write(dir.path().join("blob.bin"), [0u8, 1, 2, 3]).unwrap();
        commit_all(&repo, "First");
        fs::write(dir.path().join("blob.bin"), [0u8, 9, 9]).unwrap();
        let file = load(dir.path(), &DiffTarget::Working { path: "blob.bin".into() }).unwrap().remove(0);
        assert_eq!(file.content, FileContent::Binary);
    }

    #[test]
    fn formats_times() {
        assert_eq!(format_time(0, 0), "1970-01-01 00:00");
        assert_eq!(format_time(1_700_000_000, 120), "2023-11-15 00:13");
        assert_eq!(relative_time(100, 100), "just now");
        assert_eq!(relative_time(0, 7200), "2 hours ago");
        assert_eq!(relative_time(0, 86_400), "1 day ago");
    }
}
