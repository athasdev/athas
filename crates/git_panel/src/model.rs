//! What the panel shows, worked out from the repository's state without touching the UI.

use std::collections::HashMap;

use crate::repository::{DiffStat, FileStatus, StatusEntry};

/// A changed file as a row shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangeFile {
    /// `staged:path` or `unstaged:path`: a file changed in both places has two rows.
    pub key: String,
    pub path: String,
    pub name: String,
    pub dir: String,
    pub status: FileStatus,
    pub staged: bool,
    pub additions: usize,
    pub deletions: usize,
}

pub fn file_key(path: &str, staged: bool) -> String {
    format!("{}:{path}", if staged { "staged" } else { "unstaged" })
}

/// The file name and the folder it sits in, both relative to the repository.
pub fn split_path(path: &str) -> (String, String) {
    let path = path.trim_end_matches('/');
    match path.rsplit_once('/') {
        Some((dir, name)) => (name.to_string(), dir.to_string()),
        None => (path.to_string(), String::new()),
    }
}

pub fn change_files(entries: &[StatusEntry], stats: &[DiffStat]) -> Vec<ChangeFile> {
    let stats: HashMap<String, &DiffStat> =
        stats.iter().map(|stat| (file_key(&stat.path, stat.staged), stat)).collect();
    entries
        .iter()
        .map(|entry| {
            let key = file_key(&entry.path, entry.staged);
            let (name, dir) = split_path(&entry.path);
            let stat = stats.get(&key);
            ChangeFile {
                path: entry.path.clone(),
                name,
                dir,
                status: entry.status,
                staged: entry.staged,
                additions: stat.map_or(0, |stat| stat.additions),
                deletions: stat.map_or(0, |stat| stat.deletions),
                key,
            }
        })
        .collect()
}

/// The two lists Athas shows: what the next commit takes, and everything else (untracked files
/// included), each in path order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Groups {
    pub staged: Vec<ChangeFile>,
    pub unstaged: Vec<ChangeFile>,
}

pub fn group(files: Vec<ChangeFile>) -> Groups {
    let (mut staged, mut unstaged): (Vec<_>, Vec<_>) = files.into_iter().partition(|file| file.staged);
    let order = |a: &ChangeFile, b: &ChangeFile| a.path.cmp(&b.path);
    staged.sort_by(order);
    unstaged.sort_by(order);
    Groups { staged, unstaged }
}

/// The changes the panel lists: untracked files only with `showUntrackedFiles`.
pub fn visible_changes(files: Vec<ChangeFile>, show_untracked: bool) -> Vec<ChangeFile> {
    files.into_iter().filter(|file| show_untracked || file.status != FileStatus::Untracked).collect()
}

/// The rows of a section by folder (`gitChangesFolderView`): files at the root first, then each
/// folder in path order.
pub fn folder_groups<'a>(files: &[&'a ChangeFile]) -> Vec<(String, Vec<&'a ChangeFile>)> {
    let mut groups: std::collections::BTreeMap<String, Vec<&'a ChangeFile>> = std::collections::BTreeMap::new();
    for file in files {
        groups.entry(file.dir.clone()).or_default().push(file);
    }
    groups.into_iter().collect()
}

/// Lowercase letters and digits with every other run turned into one space, as the web search
/// normalises text.
fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = false;
    for ch in text.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(ch);
        } else {
            space = true;
        }
    }
    out
}

/// Whether `query` appears in any of `candidates`, ignoring case, punctuation and spacing.
pub fn matches_query<'a>(query: &str, candidates: impl IntoIterator<Item = &'a str>) -> bool {
    let query = normalize(query);
    if query.is_empty() {
        return true;
    }
    let compact: String = query.split(' ').collect();
    candidates.into_iter().any(|candidate| {
        let candidate = normalize(candidate);
        candidate.contains(&query) || candidate.split(' ').collect::<String>().contains(&compact)
    })
}

pub fn filter_files<'a>(files: &'a [ChangeFile], query: &str) -> Vec<&'a ChangeFile> {
    files.iter().filter(|file| matches_query(query, [file.path.as_str()])).collect()
}


/// The letter a row shows for its change, and what it means.
pub fn status_letter(status: FileStatus) -> (&'static str, &'static str) {
    match status {
        FileStatus::Modified => ("M", "Modified"),
        FileStatus::Added => ("A", "Added"),
        FileStatus::Deleted => ("D", "Deleted"),
        FileStatus::Untracked => ("U", "Untracked"),
        FileStatus::Renamed => ("R", "Renamed"),
    }
}

/// Discard turns a file back into its committed version, so untracked files have nothing to go
/// back to, and staged rows are unstaged first.
pub fn can_discard(file: &ChangeFile) -> bool {
    !file.staged && file.status != FileStatus::Untracked
}


pub fn plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "s" })
}

/// What the Commit button takes: the staged files, or with nothing staged, every change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitScope {
    Nothing,
    Staged(usize),
    All(usize),
}

impl CommitScope {
    pub fn new(staged: usize, unstaged: usize) -> Self {
        if staged > 0 {
            CommitScope::Staged(staged)
        } else if unstaged > 0 {
            CommitScope::All(unstaged)
        } else {
            CommitScope::Nothing
        }
    }

    pub fn label(self) -> String {
        match self {
            CommitScope::Nothing => "Nothing to commit".into(),
            CommitScope::Staged(count) => format!("{count} staged"),
            CommitScope::All(count) => format!("All {count}"),
        }
    }

    pub fn stages_all(self) -> bool {
        matches!(self, CommitScope::All(_))
    }

    pub fn is_empty(self) -> bool {
        self == CommitScope::Nothing
    }
}

pub fn totals<'a>(files: impl IntoIterator<Item = &'a ChangeFile>) -> (usize, usize) {
    files
        .into_iter()
        .fold((0, 0), |(additions, deletions), file| (additions + file.additions, deletions + file.deletions))
}

/// A stash's message without git's `WIP on main: abc1234` prefix.
pub fn stash_title(message: &str) -> String {
    let mut text = message.trim();
    for prefix in ["WIP on ", "On ", "index on "] {
        if text.len() >= prefix.len()
            && text[..prefix.len()].eq_ignore_ascii_case(prefix)
            && let Some((_, rest)) = text.split_once(": ")
        {
            text = rest.trim_start();
            break;
        }
    }
    if let Some((first, rest)) = text.split_once(char::is_whitespace)
        && (7..=40).contains(&first.len())
        && first.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        text = rest.trim_start();
    }
    let text = text.trim();
    if text.is_empty() { "Stashed changes".into() } else { text.into() }
}

pub fn short_hash(hash: &str) -> &str {
    &hash[..hash.len().min(7)]
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn number(text: &str) -> Option<i64> {
    (!text.is_empty() && text.bytes().all(|b| b.is_ascii_digit())).then(|| text.parse().ok()).flatten()
}

/// Seconds since the epoch for `YYYY-MM-DD` (midnight UTC) or an ISO 8601 date-time with an
/// offset, as git prints them.
/// The calendar year of a Unix time (UTC).
fn year_of(seconds: i64) -> i64 {
    // Howard Hinnant's civil_from_days, as days_from_civil's inverse.
    let days = seconds.div_euclid(86_400) + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month = (5 * day_of_year + 2) / 153;
    year_of_era + era * 400 + i64::from(month >= 10)
}

pub fn parse_git_date(text: &str) -> Option<i64> {
    let text = text.trim();
    let date = text.get(..10)?;
    let mut parts = date.split('-');
    let (year, month, day) = (number(parts.next()?)?, number(parts.next()?)?, number(parts.next()?)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut seconds = days_from_civil(year, month, day) * 86_400;
    let rest = &text[10..];
    if let Some(time) = rest.strip_prefix('T').or_else(|| rest.strip_prefix(' ')) {
        let clock = time.get(..8)?;
        let mut fields = clock.split(':');
        let (hour, minute, second) = (number(fields.next()?)?, number(fields.next()?)?, number(fields.next()?)?);
        seconds += hour * 3600 + minute * 60 + second;
        let zone = time[8..].trim();
        if let Some(sign) = zone.chars().next().filter(|ch| *ch == '+' || *ch == '-') {
            let digits: String = zone[1..].chars().filter(char::is_ascii_digit).collect();
            let hours = number(digits.get(..2)?)?;
            let minutes = digits.get(2..4).and_then(number).unwrap_or(0);
            let offset = hours * 3600 + minutes * 60;
            seconds -= if sign == '+' { offset } else { -offset };
        }
    }
    Some(seconds)
}

/// "just now", "5m ago", "2h ago", "yesterday", "3d ago", then `M/D/YYYY`, as the web workbench
/// writes dates in lists.
pub fn relative_date(text: &str, now: i64) -> String {
    let Some(then) = parse_git_date(text) else { return text.to_string() };
    let elapsed = (now - then).max(0);
    let (minutes, hours, days) = (elapsed / 60, elapsed / 3600, elapsed / 86_400);
    if minutes < 1 {
        "just now".into()
    } else if minutes < 60 {
        format!("{minutes}m ago")
    } else if hours < 24 {
        format!("{hours}h ago")
    } else if days == 1 {
        "yesterday".into()
    } else if days < 7 {
        format!("{days}d ago")
    } else {
        // "Nov 6", with the year only when it is not this one: short enough to line up in a
        // list's date column, where "11/6/2026" took a third of the row.
        let date = text.trim().get(..10).unwrap_or(text);
        let mut parts = date.split('-').filter_map(number);
        match (parts.next(), parts.next(), parts.next()) {
            (Some(year), Some(month @ 1..=12), Some(day)) => {
                let name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month as usize - 1];
                if year == year_of(now) { format!("{name} {day}") } else { format!("{name} {day}, {year}") }
            }
            _ => date.to_string(),
        }
    }
}

/// Folders the repository scan never enters (`REPO_SCAN_SKIP_DIRS`).
#[cfg(not(target_family = "wasm"))]
const REPO_SCAN_SKIP_DIRS: &[&str] = &[
    ".git", ".svn", ".hg", ".bzr", "node_modules", ".next", ".nuxt", ".turbo", ".yarn", ".pnpm", ".cache", "dist", "build", "out", "target",
    "coverage", "vendor", "__pycache__", ".venv", "venv", ".idea", ".vscode",
];
#[cfg(not(target_family = "wasm"))]
const MAX_REPO_SCAN_DIRECTORIES: usize = 10_000;
#[cfg(not(target_family = "wasm"))]
const MAX_REPO_SCAN_DEPTH: usize = 8;

/// The repositories inside a workspace folder: every folder holding `.git`, breadth first, at
/// most eight levels down and ten thousand folders in (`scanWorkspaceRepositories`).
#[cfg(not(target_family = "wasm"))]
pub fn scan_repositories(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut visited = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        if visited >= MAX_REPO_SCAN_DIRECTORIES {
            break;
        }
        visited += 1;
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut children = Vec::new();
        let mut is_repo = false;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                is_repo = true;
            }
            let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if is_dir && depth < MAX_REPO_SCAN_DEPTH && !REPO_SCAN_SKIP_DIRS.contains(&name.to_lowercase().as_str()) {
                children.push(entry.path());
            }
        }
        if is_repo {
            found.push(dir);
        }
        children.sort();
        queue.extend(children.into_iter().map(|child| (child, depth + 1)));
    }
    found
}

/// A file diff with no lines to show (a mode change, a rename without edits): the original opens
/// the file instead of an empty diff tab. Images and binary files always show their diff.
#[cfg_attr(target_family = "wasm", allow(dead_code))]
pub fn diff_is_empty(files: &[git_diff::model::FileDiff]) -> bool {
    files.iter().all(|file| match &file.content {
        git_diff::model::FileContent::Text { hunks, .. } => hunks.iter().all(|hunk| hunk.lines.is_empty()),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_diffs_open_the_file() {
        use git_diff::model::{DiffLine, FileContent, FileDiff, FileStatus as DiffStatus, Hunk, LineKind};
        let file = |content| FileDiff { path: "a.rs".into(), old_path: None, status: DiffStatus::Modified, content, additions: 0, deletions: 0, truncated: false };
        let text = |hunks| FileContent::Text { hunks, old_text: None, new_text: None };
        assert!(diff_is_empty(&[]));
        assert!(diff_is_empty(&[file(text(Vec::new()))]));
        assert!(!diff_is_empty(&[file(FileContent::Binary)]));
        let line = DiffLine { kind: LineKind::Added, old: None, new: Some(1), text: "x".into() };
        let hunk = Hunk { header: "@@ -0,0 +1 @@".into(), old_start: 0, old_lines: 0, new_start: 1, new_lines: 1, lines: vec![line] };
        assert!(!diff_is_empty(&[file(text(vec![hunk]))]));
    }

    #[test]
    fn finds_nested_repositories() {
        let dir = std::env::temp_dir().join(format!("athas-repo-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for path in ["app/.git", "libs/one/.git", "node_modules/pkg/.git", "plain/src", "a/b/c/d/e/f/g/h/i/.git"] {
            std::fs::create_dir_all(dir.join(path)).unwrap();
        }
        let found: Vec<String> = scan_repositories(&dir).iter().map(|path| path.strip_prefix(&dir).unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(found, vec!["app".to_string(), "libs/one".to_string()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn entry(path: &str, status: FileStatus, staged: bool) -> StatusEntry {
        StatusEntry { path: path.into(), status, staged }
    }

    #[test]
    fn maps_status_letters() {
        assert_eq!(status_letter(FileStatus::Modified).0, "M");
        assert_eq!(status_letter(FileStatus::Added).0, "A");
        assert_eq!(status_letter(FileStatus::Deleted).0, "D");
        assert_eq!(status_letter(FileStatus::Untracked), ("U", "Untracked"));
        assert_eq!(status_letter(FileStatus::Renamed).0, "R");
    }

    #[test]
    fn splits_name_and_folder() {
        assert_eq!(split_path("src/features/git/a.rs"), ("a.rs".into(), "src/features/git".into()));
        assert_eq!(split_path("README.md"), ("README.md".into(), String::new()));
        assert_eq!(split_path("new-folder/"), ("new-folder".into(), String::new()));
    }

    #[test]
    fn groups_staged_and_unstaged_in_path_order() {
        let entries = [
            entry("z.rs", FileStatus::Modified, false),
            entry("b/a.rs", FileStatus::Added, true),
            entry("a.rs", FileStatus::Modified, true),
            entry("a.rs", FileStatus::Modified, false),
            entry("new.txt", FileStatus::Untracked, false),
        ];
        let stats = [DiffStat { path: "a.rs".into(), staged: true, additions: 3, deletions: 1 }];
        let groups = group(change_files(&entries, &stats));
        let paths = |files: &[ChangeFile]| files.iter().map(|file| file.path.clone()).collect::<Vec<_>>();
        assert_eq!(paths(&groups.staged), ["a.rs", "b/a.rs"]);
        assert_eq!(paths(&groups.unstaged), ["a.rs", "new.txt", "z.rs"]);
        assert_eq!(groups.staged[0].key, "staged:a.rs");
        assert_eq!((groups.staged[0].additions, groups.staged[0].deletions), (3, 1));
        assert_eq!(groups.unstaged[0].additions, 0, "stats belong to one side only");
        assert_eq!(groups.staged[1].dir, "b");
    }

    #[test]
    fn hides_untracked_files_on_request() {
        let files = change_files(&[entry("a.rs", FileStatus::Modified, false), entry("new.txt", FileStatus::Untracked, false)], &[]);
        assert_eq!(visible_changes(files.clone(), true).len(), 2);
        let tracked = visible_changes(files, false);
        assert_eq!(tracked.len(), 1);
        assert_eq!(tracked[0].path, "a.rs");
    }

    #[test]
    fn groups_rows_by_folder() {
        let files = change_files(
            &[
                entry("src/b.rs", FileStatus::Modified, false),
                entry("README.md", FileStatus::Modified, false),
                entry("src/a.rs", FileStatus::Added, false),
                entry("docs/x.md", FileStatus::Modified, false),
            ],
            &[],
        );
        let refs: Vec<&ChangeFile> = files.iter().collect();
        let groups = folder_groups(&refs);
        let dirs: Vec<&str> = groups.iter().map(|(dir, _)| dir.as_str()).collect();
        assert_eq!(dirs, ["", "docs", "src"]);
        assert_eq!(groups[2].1.iter().map(|file| file.name.as_str()).collect::<Vec<_>>(), ["b.rs", "a.rs"]);
    }

    #[test]
    fn only_tracked_unstaged_changes_discard() {
        let files = change_files(
            &[
                entry("a", FileStatus::Modified, false),
                entry("b", FileStatus::Untracked, false),
                entry("c", FileStatus::Modified, true),
            ],
            &[],
        );
        assert_eq!(files.iter().map(can_discard).collect::<Vec<_>>(), [true, false, false]);
    }

    #[test]
    fn filters_like_the_web_search() {
        let files = change_files(
            &[entry("src/git_panel.rs", FileStatus::Modified, false), entry("README.md", FileStatus::Modified, false)],
            &[],
        );
        assert_eq!(filter_files(&files, "").len(), 2);
        assert_eq!(filter_files(&files, "GIT panel")[0].path, "src/git_panel.rs");
        assert_eq!(filter_files(&files, "gitpanel").len(), 1);
        assert!(filter_files(&files, "missing").is_empty());
    }

    #[test]
    fn commit_scope_falls_back_to_everything() {
        assert_eq!(CommitScope::new(0, 0).label(), "Nothing to commit");
        assert_eq!(CommitScope::new(2, 5).label(), "2 staged");
        assert!(CommitScope::new(0, 5).stages_all());
        assert_eq!(CommitScope::new(0, 5).label(), "All 5");
    }

    #[test]
    fn cleans_stash_titles() {
        assert_eq!(stash_title("WIP on main: 1a2b3c4 Fix the thing"), "Fix the thing");
        assert_eq!(stash_title("On feature/x: WIP from sidebar"), "WIP from sidebar");
        assert_eq!(stash_title("  "), "Stashed changes");
        assert_eq!(stash_title("plain message"), "plain message");
    }

    #[test]
    fn parses_git_dates() {
        assert_eq!(parse_git_date("1970-01-02"), Some(86_400));
        assert_eq!(parse_git_date("2024-03-01T12:00:00+02:00"), Some(days_from_civil(2024, 3, 1) * 86_400 + 10 * 3600));
        assert_eq!(parse_git_date("2024-03-01T12:00:00Z"), Some(days_from_civil(2024, 3, 1) * 86_400 + 12 * 3600));
        assert_eq!(parse_git_date("nonsense"), None);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    }

    #[test]
    fn writes_relative_dates() {
        let now = parse_git_date("2026-11-11T12:00:00Z").unwrap();
        assert_eq!(relative_date("2026-11-11T11:59:40Z", now), "just now");
        assert_eq!(relative_date("2026-11-11T11:15:00Z", now), "45m ago");
        assert_eq!(relative_date("2026-11-11", now), "12h ago");
        assert_eq!(relative_date("2026-11-10", now), "yesterday");
        assert_eq!(relative_date("2026-11-07", now), "4d ago");
        assert_eq!(relative_date("2026-10-01", now), "Oct 1");
        assert_eq!(relative_date("2025-12-31", now), "Dec 31, 2025");
        assert_eq!(relative_date("2026-01-01T00:00:00Z", now), "Jan 1");
    }
}
