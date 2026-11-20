//! Context the composer attaches that is not a single file (`lib/context-references.ts`): a
//! folder (its tree and small files), the working tree or staged Git diff, the Problems list, and
//! editor selections (`editor.addSelectionToChat`). Each is read into text when attached, within
//! a token budget, and goes along with the prompt as a labelled section.

use std::{
    path::{Path, PathBuf},
    process::Command,
};

/// Token budgets per reference, so one never crowds out the rest of the request.
const FOLDER_BUDGET: usize = 8_000;
const GIT_DIFF_BUDGET: usize = 12_000;
const PROBLEMS_BUDGET: usize = 4_000;
const SELECTION_BUDGET: usize = 6_000;

const FOLDER_MAX_ENTRIES: usize = 400;
const FOLDER_MAX_DEPTH: usize = 6;
const FOLDER_MAX_FILE_READS: usize = 40;
/// Folder files larger than this are listed in the tree but not inlined.
const FOLDER_SMALL_FILE_TOKENS: usize = 1_500;
const PROBLEMS_MAX_ENTRIES: usize = 200;
const IGNORED_DIRECTORIES: &[&str] = &[".git", ".next", ".turbo", ".venv", "__pycache__", "build", "coverage", "dist", "node_modules", "out", "target", "vendor"];
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "pdf", "zip", "gz", "tgz", "tar", "7z", "rar", "woff", "woff2", "ttf", "otf", "eot", "mp3",
    "mp4", "mov", "wav", "ogg", "webm", "wasm", "so", "dylib", "dll", "exe", "bin", "lock", "sqlite", "db",
];

/// Something the composer attaches besides files.
#[derive(Clone, Debug, PartialEq)]
pub enum ContextRef {
    Folder(PathBuf),
    GitDiff { staged: bool },
    Problems,
    /// Lines `start_line..=end_line` (1-based) of `path`, as the editor selected them.
    Selection { path: PathBuf, start_line: usize, end_line: usize, text: String },
    /// A tab open in the centre: a file (its text goes along) or a tool's view, such as a pull
    /// request (named only).
    Tab { title: String, path: Option<PathBuf>, kind: Option<String>, id: Option<String> },
}

/// The GitHub views among open tabs, which the Add context menu lists apart.
pub const GITHUB_KINDS: &[&str] = &["github-pr", "github-issue", "github-run", "github-release", "github-deployment"];

impl ContextRef {
    pub fn from_tab(tab: &workbench_api::OpenTab) -> Self {
        ContextRef::Tab { title: tab.title.clone(), path: tab.path.clone(), kind: tab.kind.clone(), id: tab.id.clone() }
    }

    pub fn is_github(&self) -> bool {
        matches!(self, ContextRef::Tab { kind: Some(kind), .. } if GITHUB_KINDS.contains(&kind.as_str()))
    }
}

/// What a tool's tab is, as the prompt names it (`formatOpenContextSummary`).
fn tab_summary(title: &str, kind: &str, id: &str) -> String {
    match kind {
        "github-pr" => format!("GitHub pull request: {title} (#{id})"),
        "github-issue" => format!("GitHub issue: {title} (#{id})"),
        "github-run" => format!("GitHub action run: {title} (#{id})"),
        "github-release" => format!("GitHub release: {title} (ID: {id})"),
        "github-deployment" => format!("GitHub deployment: {title} (ID: {id})"),
        "database" => format!("Database: {title}"),
        _ => format!("{title} ({kind})"),
    }
}

/// An open tab's section: a file's name and path with its text (long files keep their first 50
/// and last 20 lines), or what a tool's view shows.
pub fn resolve_tab(reference: &ContextRef, root: Option<&Path>) -> String {
    format_tab(reference, root, None)
}

/// An open tab's section with `text` (what its editor holds, unsaved edits included) in place
/// of the file on disk.
pub fn format_tab(reference: &ContextRef, root: Option<&Path>, text: Option<&str>) -> String {
    let ContextRef::Tab { title, path, kind, id } = reference else { return String::new() };
    let Some(path) = path else {
        return tab_summary(title, kind.as_deref().unwrap_or_default(), id.as_deref().unwrap_or_default());
    };
    let summary = format!("{title}: {}", relative(path, root));
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    if is_secret(&name) || is_binary(&name) {
        return summary;
    }
    let content = match text {
        Some(text) => text.to_string(),
        None => match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(_) => return summary,
        },
    };
    let lines: Vec<&str> = content.split('\n').collect();
    let preview = if lines.len() <= 80 {
        content.clone()
    } else {
        [&lines[..50], &["... (content truncated) ..."], &lines[lines.len() - 20..]].concat().join("\n")
    };
    fit(&format!("{summary}\n```text\n{preview}\n```"), FOLDER_BUDGET).0
}

/// One diagnostic for the Problems reference.
#[derive(Clone, Debug, PartialEq)]
pub struct Problem {
    pub path: PathBuf,
    /// 0-based, as the server sends them.
    pub line: u32,
    pub column: u32,
    /// "error", "warning", "info" or "hint".
    pub severity: &'static str,
    pub message: String,
    pub origin: Option<String>,
}

impl ContextRef {
    /// A short name and a description for chips and the attachment list.
    pub fn describe(&self, root: Option<&Path>) -> (String, String) {
        match self {
            ContextRef::Folder(path) => {
                let name = path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned());
                (format!("{name}/"), relative(path, root))
            }
            ContextRef::GitDiff { staged: true } => ("Staged changes".into(), "git diff --staged".into()),
            ContextRef::GitDiff { staged: false } => ("Working tree changes".into(), "git diff".into()),
            ContextRef::Problems => ("Problems".into(), "Current errors and warnings".into()),
            ContextRef::Selection { path, start_line, end_line, .. } => {
                let name = path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned());
                let lines = if start_line == end_line { format!("{start_line}") } else { format!("{start_line}-{end_line}") };
                (format!("{name}:{lines}"), relative(path, root))
            }
            ContextRef::Tab { title, path: Some(path), .. } => (title.clone(), relative(path, root)),
            ContextRef::Tab { title, kind, id, .. } => {
                let id = id.as_deref().unwrap_or_default();
                let description = match kind.as_deref().unwrap_or_default() {
                    "github-pr" => format!("Pull request #{id}"),
                    "github-issue" => format!("Issue #{id}"),
                    "github-run" => format!("Action run #{id}"),
                    "github-release" => "Release".to_string(),
                    "github-deployment" => "Deployment".to_string(),
                    other => other.to_string(),
                };
                (title.clone(), description)
            }
        }
    }

    /// The section heading the prompt carries.
    pub fn label(&self, root: Option<&Path>) -> String {
        let (name, description) = self.describe(root);
        format!("{name} ({description})")
    }
}

fn relative(path: &Path, root: Option<&Path>) -> String {
    root.and_then(|root| path.strip_prefix(root).ok()).map(|path| path.to_string_lossy().replace('\\', "/")).filter(|path| !path.is_empty()).unwrap_or_else(|| path.display().to_string())
}

/// Roughly four characters a token, as the original estimates.
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

/// `text` cut to about `max_tokens`, and whether it was cut.
pub fn fit(text: &str, max_tokens: usize) -> (String, bool) {
    let max_chars = max_tokens * 4;
    if text.chars().count() <= max_chars {
        return (text.to_string(), false);
    }
    let cut: String = text.chars().take(max_chars).collect();
    (format!("{cut}\n[Truncated]"), true)
}

fn is_secret(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == ".env" || name.starts_with(".env.") || [".pem", ".key", ".p12", ".pfx"].iter().any(|ext| name.ends_with(ext)) || name.starts_with("id_rsa") || name.starts_with("id_ed25519") || name.starts_with("id_ecdsa") || name.starts_with("id_dsa")
}

fn is_binary(name: &str) -> bool {
    Path::new(name).extension().and_then(|ext| ext.to_str()).is_some_and(|ext| BINARY_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// The folder's tree (breadth first, bounded) and the small text files in it, nearest first.
pub fn resolve_folder(path: &Path) -> String {
    resolve_folder_within(path, None)
}

/// `resolve_folder` with what the project's context policy leaves out left out.
pub fn resolve_folder_within(path: &Path, policy: Option<&ai_tools::ContextPolicy>) -> String {
    if policy.is_some_and(|policy| !policy.allows(path, true)) {
        return "This folder is excluded from AI context.".into();
    }
    let mut tree = Vec::new();
    let mut files: Vec<(PathBuf, String, usize)> = Vec::new();
    let mut truncated = false;
    let mut queue = std::collections::VecDeque::from([(path.to_path_buf(), 0usize)]);
    'walk: while let Some((directory, depth)) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&directory) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if tree.len() >= FOLDER_MAX_ENTRIES {
                truncated = true;
                break 'walk;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if policy.is_some_and(|policy| !policy.allows(&entry.path(), is_dir)) {
                continue;
            }
            let relative = entry.path().strip_prefix(path).map(|path| path.to_string_lossy().replace('\\', "/")).unwrap_or(name.clone());
            tree.push(if is_dir { format!("{relative}/") } else { relative.clone() });
            if is_dir {
                if IGNORED_DIRECTORIES.contains(&name.as_str()) {
                    continue;
                }
                if depth + 1 < FOLDER_MAX_DEPTH {
                    queue.push_back((entry.path(), depth + 1));
                } else {
                    truncated = true;
                }
            } else if !is_binary(&name) && !is_secret(&name) {
                files.push((entry.path(), relative, depth));
            }
        }
    }
    tree.sort();
    let mut sections = vec![format!("Folder tree ({} entries):\n{}", tree.len(), tree.join("\n"))];
    let mut remaining = FOLDER_BUDGET.saturating_sub(estimate_tokens(&sections[0]));
    files.sort_by(|left, right| left.2.cmp(&right.2).then_with(|| left.1.cmp(&right.1)));
    let total = files.len();
    for (file, relative, _) in files.into_iter().take(FOLDER_MAX_FILE_READS) {
        if remaining < 200 {
            break;
        }
        let Ok(content) = std::fs::read_to_string(&file) else { continue };
        let tokens = estimate_tokens(&content);
        if tokens > FOLDER_SMALL_FILE_TOKENS || tokens + 20 > remaining {
            continue;
        }
        sections.push(format!("--- {relative} ---\n{content}"));
        remaining -= tokens + 20;
    }
    if total > sections.len() - 1 {
        sections.push("[Larger or further files are listed in the tree only; read them when needed.]".into());
    }
    let (mut text, cut) = fit(&sections.join("\n\n"), FOLDER_BUDGET);
    if truncated && !cut {
        text.push_str("\n[Truncated]");
    }
    text
}

pub(crate) fn git(repo: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").arg("-C").arg(repo).args(["--no-pager", "-c", "core.quotepath=off"]).args(args).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A changed file the Add context menu offers under Git changes (`getGitContextFiles`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitChange {
    /// Relative to the repository.
    pub path: String,
    pub absolute: PathBuf,
    /// `modified`, `added`, `renamed`, `copied` or `untracked`.
    pub status: &'static str,
    pub staged: bool,
}

/// The changed files of `repo` from `git status --porcelain`, one per path (staged when either
/// side is), deleted files left out, by path.
pub fn parse_git_changes(repo: &Path, porcelain: &str) -> Vec<GitChange> {
    fn status(code: char) -> Option<&'static str> {
        match code {
            'M' | 'T' | 'U' => Some("modified"),
            'A' => Some("added"),
            'R' => Some("renamed"),
            'C' => Some("copied"),
            '?' => Some("untracked"),
            _ => None,
        }
    }
    let mut changes: Vec<GitChange> = Vec::new();
    for line in porcelain.lines() {
        let mut codes = line.chars();
        let (Some(index), Some(worktree)) = (codes.next(), codes.next()) else { continue };
        let Some(path) = line.get(3..) else { continue };
        let path = path.rsplit(" -> ").next().unwrap_or(path).trim_matches('"').to_string();
        if index == 'D' || worktree == 'D' {
            continue;
        }
        let staged = index != ' ' && index != '?';
        let Some(code) = status(if staged { index } else { worktree }) else { continue };
        match changes.iter_mut().find(|change| change.path == path) {
            Some(existing) => existing.staged |= staged,
            None => changes.push(GitChange { absolute: repo.join(&path), path, status: code, staged }),
        }
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    changes
}

pub fn git_changes(repo: &Path) -> Vec<GitChange> {
    git(repo, &["status", "--porcelain", "--untracked-files=all"]).map(|text| parse_git_changes(repo, &text)).unwrap_or_default()
}

/// The branch, the changed files and their patches, for the working tree or the index.
pub fn resolve_git_diff(repo: &Path, staged: bool) -> String {
    resolve_git_diff_within(repo, staged, None)
}

/// A per-file patch takes at most this much of the diff budget, so one huge file never crowds
/// out the rest (`resolveGitDiff`).
const GIT_FILE_PATCH_TOKENS: usize = 4_000;

/// `resolve_git_diff` with the files the context policy leaves out left out: a summary of the
/// changed files, then each file's patch within what is left of the budget.
pub fn resolve_git_diff_within(repo: &Path, staged: bool, policy: Option<&ai_tools::ContextPolicy>) -> String {
    let Some(branch) = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]) else { return "Not a Git repository.".into() };
    // The repository's top folder under the same spelling as `repo` (not resolved through
    // symlinks), so the policy's project root still matches it.
    let Some(prefix) = git(repo, &["rev-parse", "--show-prefix"]) else { return "Not a Git repository.".into() };
    let mut top = repo.to_path_buf();
    for _ in Path::new(prefix.trim()).components() {
        top.pop();
    }
    let mut args = vec!["diff", "--name-status", "-M"];
    if staged {
        args.push("--staged");
    }
    // (status word, path, path before a rename)
    let mut files: Vec<(&'static str, String, Option<String>)> = git(&top, &args)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let code = fields.next()?.chars().next()?;
            let first = fields.next()?.to_string();
            let status = match code {
                'A' => "added",
                'D' => "deleted",
                'R' => "renamed",
                'C' => "copied",
                _ => "modified",
            };
            Some(match fields.next() {
                Some(second) => (status, second.to_string(), Some(first)),
                None => (status, first, None),
            })
        })
        .collect();
    if !staged && let Some(others) = git(&top, &["ls-files", "--others", "--exclude-standard"]) {
        files.extend(others.lines().filter(|line| !line.is_empty()).map(|line| ("untracked", line.to_string(), None)));
    }
    files.retain(|(_, path, _)| policy.is_none_or(|policy| policy.allows(&top.join(path), false)));
    if files.is_empty() {
        return if staged { "No staged changes.".into() } else { "No unstaged changes.".into() };
    }
    let summary = files.iter().map(|(status, path, _)| format!("{status}: {path}")).collect::<Vec<_>>().join("\n");
    let mut sections = vec![format!("Branch: {}\n{summary}", branch.trim())];
    let mut remaining = GIT_DIFF_BUDGET.saturating_sub(estimate_tokens(&sections[0]));
    let mut truncated = false;
    for (status, path, old) in &files {
        if remaining < 200 {
            truncated = true;
            break;
        }
        let patch = if *status == "untracked" {
            untracked_patch(&top, path)
        } else {
            let mut args = vec!["diff", "-M"];
            if staged {
                args.push("--staged");
            }
            args.push("--");
            args.push(path);
            if let Some(old) = old {
                args.push(old);
            }
            git(&top, &args)
        };
        let Some(patch) = patch.filter(|patch| !patch.trim().is_empty()) else { continue };
        let (patch, cut) = fit(patch.trim_end(), remaining.min(GIT_FILE_PATCH_TOKENS));
        truncated |= cut;
        remaining = remaining.saturating_sub(estimate_tokens(&patch));
        sections.push(patch);
    }
    let (mut text, cut) = fit(&sections.join("\n\n"), GIT_DIFF_BUDGET);
    if truncated && !cut && !text.ends_with("[Truncated]") {
        text.push_str("\n[Truncated]");
    }
    text
}

/// A new file's patch: every line added (`formatGitDiff` for `is_new`), or a note for binaries.
fn untracked_patch(top: &Path, path: &str) -> Option<String> {
    let header = format!("new file: {path}");
    if is_binary(path) {
        return Some(format!("{header} (binary)"));
    }
    let bytes = std::fs::read(top.join(path)).ok()?;
    let Ok(text) = String::from_utf8(bytes) else { return Some(format!("{header} (binary)")) };
    let lines: Vec<String> = text.lines().map(|line| format!("+{line}")).collect();
    Some(format!("{header}\n{}", lines.join("\n")))
}

/// Errors first, then warnings and infos, by file and line.
pub fn format_problems(problems: &[Problem], root: Option<&Path>) -> String {
    let order = |severity: &str| match severity {
        "error" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    };
    let mut sorted: Vec<&Problem> = problems.iter().collect();
    sorted.sort_by(|left, right| order(left.severity).cmp(&order(right.severity)).then_with(|| left.path.cmp(&right.path)).then(left.line.cmp(&right.line)));
    let count = |severity: &str| problems.iter().filter(|problem| problem.severity == severity).count();
    let mut lines = vec![format!("{} errors, {} warnings, {} infos", count("error"), count("warning"), count("info") + count("hint"))];
    for problem in sorted.iter().take(PROBLEMS_MAX_ENTRIES) {
        let message = problem.message.split_whitespace().collect::<Vec<_>>().join(" ");
        let origin = problem.origin.as_ref().map(|origin| format!(" ({origin})")).unwrap_or_default();
        lines.push(format!("{}:{}:{} {}: {message}{origin}", relative(&problem.path, root), problem.line + 1, problem.column + 1, problem.severity));
    }
    if sorted.len() > PROBLEMS_MAX_ENTRIES {
        lines.push(format!("... and {} more", sorted.len() - PROBLEMS_MAX_ENTRIES));
    }
    fit(&lines.join("\n"), PROBLEMS_BUDGET).0
}

/// `format_problems` without the files the context policy leaves out.
pub fn format_problems_within(problems: &[Problem], root: Option<&Path>, policy: Option<&ai_tools::ContextPolicy>) -> String {
    let allowed: Vec<Problem> = problems.iter().filter(|problem| policy.is_none_or(|policy| policy.allows(&problem.path, false))).cloned().collect();
    format_problems(&allowed, root)
}

/// The problems the language servers report now.
pub fn current_problems(cx: &gpui::App) -> Vec<Problem> {
    let Some(store) = cx.try_global::<lsp_client::DiagnosticsStore>() else { return Vec::new() };
    store
        .files()
        .flat_map(|(path, diagnostics)| {
            diagnostics
                .into_iter()
                .map(|diagnostic| Problem {
                    path: path.to_path_buf(),
                    line: diagnostic.range.start.line,
                    column: diagnostic.range.start.character,
                    severity: match diagnostic.severity {
                        lsp_client::Severity::Error => "error",
                        lsp_client::Severity::Warning => "warning",
                        lsp_client::Severity::Info => "info",
                        lsp_client::Severity::Hint => "hint",
                    },
                    message: diagnostic.message.clone(),
                    origin: diagnostic.origin(),
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// The text of a selection reference.
pub fn format_selection(path: &Path, text: &str) -> String {
    let language = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default();
    fit(&format!("```{language}\n{text}\n```"), SELECTION_BUDGET).0
}

#[cfg(test)]
mod tab_tests {
    use super::*;

    #[test]
    fn open_tabs_go_along_as_text_or_by_name() {
        let pr = ContextRef::Tab { title: "Fix login".into(), path: None, kind: Some("github-pr".into()), id: Some("42".into()) };
        assert!(pr.is_github());
        assert_eq!(pr.describe(None), ("Fix login".into(), "Pull request #42".into()));
        assert_eq!(resolve_tab(&pr, None), "GitHub pull request: Fix login (#42)");

        let dir = tempfile::tempdir().unwrap();
        let long: String = (1..=100).map(|line| format!("line {line}\n")).collect();
        std::fs::write(dir.path().join("a.rs"), long).unwrap();
        let file = ContextRef::Tab { title: "a.rs".into(), path: Some(dir.path().join("a.rs")), kind: None, id: None };
        let text = resolve_tab(&file, Some(dir.path()));
        assert!(text.starts_with("a.rs: a.rs\n```text\nline 1\n"));
        assert!(text.contains("line 50\n... (content truncated) ...\nline 82\n"));
        assert!(!text.contains("line 51\n"));
        // An editor's unsaved text stands in for the file.
        assert_eq!(format_tab(&file, Some(dir.path()), Some("fn unsaved() {}")), "a.rs: a.rs\n```text\nfn unsaved() {}\n```");
    }
}

/// Folders of the project the user can attach, from its file list (relative paths).
pub fn project_folders(files: &[String]) -> Vec<String> {
    let mut folders = std::collections::BTreeSet::new();
    for file in files {
        let mut parts: Vec<&str> = file.split('/').collect();
        parts.pop();
        if parts.iter().any(|part| IGNORED_DIRECTORIES.contains(part)) {
            continue;
        }
        for depth in 1..=parts.len() {
            folders.insert(parts[..depth].join("/"));
        }
    }
    folders.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_list_the_tree_and_inline_small_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src/nested")).unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("src/nested/a.txt"), "a").unwrap();
        std::fs::write(dir.path().join(".env"), "SECRET=1").unwrap();
        std::fs::write(dir.path().join("logo.png"), [0u8; 4]).unwrap();
        std::fs::write(dir.path().join("node_modules/x/index.js"), "x").unwrap();
        let text = resolve_folder(dir.path());
        assert!(text.contains("Folder tree"));
        assert!(text.contains("src/nested/a.txt"));
        assert!(text.contains("--- src/main.rs ---\nfn main() {}"));
        assert!(text.contains(".env"));
        assert!(!text.contains("SECRET"));
        assert!(!text.contains("node_modules/x/index.js"));
    }

    #[test]
    fn git_diffs_go_file_by_file_without_what_the_policy_keeps_out() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let run = |args: &[&str]| assert!(Command::new("git").arg("-C").arg(root).args(args).output().unwrap().status.success());
        run(&["init", "-q"]);
        run(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        run(&["add", "a.txt"]);
        run(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
        std::fs::write(root.join("a.txt"), "two\n").unwrap();
        std::fs::write(root.join("new.txt"), "fresh\n").unwrap();
        std::fs::write(root.join(".aiignore"), "secret.txt\n").unwrap();
        std::fs::write(root.join("secret.txt"), "hidden\n").unwrap();
        let policy = ai_tools::context_policy(Some(root)).unwrap();
        let text = resolve_git_diff_within(root, false, Some(&policy));
        assert!(text.contains("modified: a.txt"), "{text}");
        assert!(text.contains("untracked: new.txt"));
        assert!(text.contains("-one\n+two"));
        assert!(text.contains("new file: new.txt\n+fresh"));
        assert!(!text.contains("untracked: secret.txt") && !text.contains("hidden"));
        assert_eq!(resolve_git_diff_within(root, true, Some(&policy)), "No staged changes.");
        let outside = tempfile::tempdir().unwrap();
        assert_eq!(resolve_git_diff(outside.path(), false), "Not a Git repository.");
    }

    #[test]
    fn problems_sort_by_severity_and_name_their_origin() {
        let problems = vec![
            Problem { path: "/p/b.rs".into(), line: 2, column: 0, severity: "warning", message: "unused\n  var".into(), origin: None },
            Problem { path: "/p/a.rs".into(), line: 0, column: 4, severity: "error", message: "boom".into(), origin: Some("rustc E0308".into()) },
        ];
        let text = format_problems(&problems, Some(Path::new("/p")));
        assert_eq!(text, "1 errors, 1 warnings, 0 infos\na.rs:1:5 error: boom (rustc E0308)\nb.rs:3:1 warning: unused var");
    }

    #[test]
    fn git_changes_merge_sides_and_skip_deletions() {
        let repo = Path::new("/repo");
        let changes = parse_git_changes(repo, "MM src/b.rs\n D gone.rs\n?? new.txt\nR  old.rs -> src/a.rs\n M src/c.rs\n");
        let read: Vec<(&str, &str, bool)> = changes.iter().map(|change| (change.path.as_str(), change.status, change.staged)).collect();
        assert_eq!(read, [("new.txt", "untracked", false), ("src/a.rs", "renamed", true), ("src/b.rs", "modified", true), ("src/c.rs", "modified", false)]);
        assert_eq!(changes[0].absolute, PathBuf::from("/repo/new.txt"));
    }

    #[test]
    fn descriptions_and_folders() {
        let (name, description) = ContextRef::Folder("/p/src/ui".into()).describe(Some(Path::new("/p")));
        assert_eq!((name.as_str(), description.as_str()), ("ui/", "src/ui"));
        let selection = ContextRef::Selection { path: "/p/a.rs".into(), start_line: 3, end_line: 5, text: String::new() };
        assert_eq!(selection.describe(Some(Path::new("/p"))).0, "a.rs:3-5");
        assert_eq!(project_folders(&["src/a/b.rs".into(), "README.md".into(), "target/x".into()]), vec!["src", "src/a"]);
        assert_eq!(fit("abcdefghij", 1), ("abcd\n[Truncated]".to_string(), true));
    }
}
