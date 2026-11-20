//! What a link in the transcript points at and shows (`lib/chat-link-target.ts`,
//! `github/utils/github-link-utils.ts`): GitHub pull requests, issues, runs and commits read as
//! `owner/repo#12`, bare web addresses as host and short path, files as name and line.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GitHubEntity {
    PullRequest { owner: String, repo: String, number: u64 },
    Issue { owner: String, repo: String, number: u64 },
    ActionRun { owner: String, repo: String, run_id: u64 },
    Commit { owner: String, repo: String, sha: String },
}

impl GitHubEntity {
    fn repository(&self) -> (&str, &str) {
        match self {
            GitHubEntity::PullRequest { owner, repo, .. }
            | GitHubEntity::Issue { owner, repo, .. }
            | GitHubEntity::ActionRun { owner, repo, .. }
            | GitHubEntity::Commit { owner, repo, .. } => (owner, repo),
        }
    }

    /// `athasdev/athas#12`, or `#12` when it belongs to the open project.
    pub fn reference(&self, same_repository: bool) -> String {
        let (owner, repo) = self.repository();
        let repository = if same_repository { String::new() } else { format!("{owner}/{repo}") };
        match self {
            GitHubEntity::PullRequest { number, .. } | GitHubEntity::Issue { number, .. } => format!("{repository}#{number}"),
            GitHubEntity::Commit { sha, .. } => {
                let sep = if repository.is_empty() { "" } else { "@" };
                format!("{repository}{sep}{}", &sha[..sha.len().min(7)])
            }
            GitHubEntity::ActionRun { run_id, .. } => {
                let sep = if repository.is_empty() { "" } else { " " };
                format!("{repository}{sep}run {run_id}")
            }
        }
    }

    /// The tool view that shows it in Athas, as (resource kind, id), when it has one.
    pub fn resource(&self) -> Option<(&'static str, String)> {
        match self {
            GitHubEntity::PullRequest { number, .. } => Some(("github-pr", number.to_string())),
            GitHubEntity::Issue { number, .. } => Some(("github-issue", number.to_string())),
            GitHubEntity::ActionRun { run_id, .. } => Some(("github-run", run_id.to_string())),
            GitHubEntity::Commit { .. } => None,
        }
    }

    pub fn belongs_to(&self, repository: &(String, String)) -> bool {
        let (owner, repo) = self.repository();
        owner.eq_ignore_ascii_case(&repository.0) && repo.eq_ignore_ascii_case(&repository.1)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkTarget {
    GitHub(GitHubEntity),
    Web { host: String, path: String },
    Mail(String),
    File { path: String, line: Option<u32> },
}

const MAX_PATH_LENGTH: usize = 36;

pub(crate) fn decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(byte) = u8::from_str_radix(std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""), 16)
        {
            out.push(byte);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_string())
}

fn is_external(href: &str) -> bool {
    let Some((scheme, _)) = href.split_once(':') else { return false };
    let valid = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c));
    valid && scheme.len() > 1 && !["file", "remote", "wsl"].contains(&scheme.to_ascii_lowercase().as_str())
}

/// A GitHub pull request, issue, workflow run or commit address.
pub fn parse_github(href: &str) -> Option<GitHubEntity> {
    let rest = href.strip_prefix("https://").or_else(|| href.strip_prefix("http://"))?;
    let (host, path) = rest.split_once('/')?;
    if !matches!(host.to_ascii_lowercase().as_str(), "github.com" | "www.github.com") {
        return None;
    }
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
    if segments.len() < 4 {
        return None;
    }
    let (owner, repo) = (segments[0].to_string(), segments[1].to_string());
    let number = |value: &str| value.parse::<u64>().ok().filter(|_| value.chars().all(|c| c.is_ascii_digit()));
    match segments[2] {
        "pull" => Some(GitHubEntity::PullRequest { owner, repo, number: number(segments[3])? }),
        "issues" => Some(GitHubEntity::Issue { owner, repo, number: number(segments[3])? }),
        "actions" if segments[3] == "runs" => Some(GitHubEntity::ActionRun { owner, repo, run_id: number(segments.get(4)?)? }),
        "commit" if (7..=40).contains(&segments[3].len()) && segments[3].chars().all(|c| c.is_ascii_hexdigit()) => {
            Some(GitHubEntity::Commit { owner, repo, sha: segments[3].to_string() })
        }
        _ => None,
    }
}

pub fn target(href: &str) -> LinkTarget {
    let trimmed = href.trim();
    if trimmed.len() > 7 && trimmed.get(..7).is_some_and(|scheme| scheme.eq_ignore_ascii_case("mailto:")) {
        return LinkTarget::Mail(decode(trimmed[7..].split('?').next().unwrap_or_default()));
    }
    if is_external(trimmed) {
        if let Some(entity) = parse_github(trimmed) {
            return LinkTarget::GitHub(entity);
        }
        let after_scheme = trimmed.split_once("://").map_or(trimmed, |(_, rest)| rest);
        let (host, path) = after_scheme.split_once('/').map_or((after_scheme, String::new()), |(host, path)| (host, format!("/{path}")));
        let path = decode(path.split('#').next().unwrap_or_default());
        let host = host.strip_prefix("www.").unwrap_or(host).to_string();
        return LinkTarget::Web { host, path: path.trim_end_matches('/').to_string() };
    }
    let value = decode(trimmed.strip_prefix("file://").unwrap_or(trimmed));
    let (path, line) = split_line(&value);
    LinkTarget::File { path: path.to_string(), line }
}

/// `path:12`, `path:12:3` or `path#L12-L14`.
fn split_line(value: &str) -> (&str, Option<u32>) {
    if let Some((path, anchor)) = value.rsplit_once("#L") {
        let line = anchor.split(['-']).next().and_then(|line| line.parse().ok());
        if line.is_some() {
            return (path, line);
        }
    }
    let mut parts = value.rsplitn(3, ':');
    let last = parts.next();
    let middle = parts.next();
    let rest = parts.next();
    match (last, middle, rest) {
        (Some(column), Some(line), Some(path)) if column.parse::<u32>().is_ok() && line.parse::<u32>().is_ok() => (path, line.parse().ok()),
        (Some(line), Some(_), _) if line.parse::<u32>().is_ok() => (&value[..value.len() - line.len() - 1], line.parse().ok()),
        _ => (value, None),
    }
}

/// A file a link in an answer leads to, with the line and column it names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileLink {
    pub path: PathBuf,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

/// `path`, `./path`, `file://path`, `path:12:3`, `path#L12-L14` or `path#line-12`, without a query.
fn parse_file_candidate(raw: &str) -> Option<(String, Option<u32>, Option<u32>)> {
    let decoded = decode(raw.trim());
    let value = decoded.trim().trim_start_matches('<').trim_end_matches('>');
    let value = value.strip_prefix("file://").unwrap_or(value);
    if value.is_empty() || value.starts_with('#') || is_external(value) {
        return None;
    }
    let mut value = value.split('?').next().unwrap_or_default().to_string();
    let (mut line, mut column) = (None, None);
    let lower = value.to_ascii_lowercase();
    if let Some(at) = ["#line-", "#line", "#l"].iter().find_map(|anchor| lower.rfind(anchor).map(|at| (at, anchor.len()))) {
        let digits: String = value[at.0 + at.1..].chars().take_while(char::is_ascii_digit).collect();
        line = digits.parse().ok();
        value.truncate(at.0);
    } else {
        let mut parts = value.rsplitn(3, ':');
        let (last, middle) = (parts.next().unwrap_or_default(), parts.next());
        let is_number = |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_digit());
        let drive_only = middle.is_some_and(|middle| middle.len() == 1 && parts.next().is_none());
        if is_number(last) && middle.is_some() && !drive_only {
            match middle.filter(|middle| is_number(middle)) {
                Some(middle) => {
                    (line, column) = (middle.parse().ok(), last.parse().ok());
                    value.truncate(value.len() - last.len() - middle.len() - 2);
                }
                None => {
                    line = last.parse().ok();
                    value.truncate(value.len() - last.len() - 1);
                }
            }
        } else if let Some(hash) = value.find('#') {
            value.truncate(hash);
        }
    }
    let value = value.strip_prefix("./").unwrap_or(&value).trim_end_matches(['/', '\\']).replace('\\', "/");
    if value.is_empty() || value == "." {
        return None;
    }
    Some((value, line.filter(|line| *line > 0), column.filter(|column| *column > 0)))
}

/// The project file a link names (`resolveWorkspaceFileLink`): an absolute path, a path from the
/// project folder, or the closest match among `files` (relative to `root`) by path suffix or
/// file name, the shortest path winning a tie. The link's text is tried when its target is not
/// a file. External addresses resolve to nothing.
pub fn resolve_file_link(href: &str, label: &str, files: &[String], root: Option<&Path>, exists: impl Fn(&Path) -> bool) -> Option<FileLink> {
    if is_external(href.trim()) {
        return None;
    }
    for (candidate, line, column) in [href, label].into_iter().filter_map(parse_file_candidate) {
        let direct = Path::new(&candidate);
        if direct.is_absolute() && exists(direct) {
            return Some(FileLink { path: direct.to_path_buf(), line, column });
        }
        let relative = candidate.trim_start_matches('/');
        if let Some(root) = root
            && exists(&root.join(relative))
        {
            return Some(FileLink { path: root.join(relative), line, column });
        }
        let name_lower = relative.to_lowercase();
        let score = |file: &String| -> Option<u8> {
            let name = file.rsplit('/').next().unwrap_or(file);
            if file == relative {
                Some(2)
            } else if file.ends_with(&format!("/{relative}")) {
                Some(3)
            } else if name == relative {
                Some(4)
            } else if name.to_lowercase() == name_lower {
                Some(5)
            } else {
                None
            }
        };
        let best = files.iter().filter_map(|file| score(file).map(|score| (score, file.len(), file))).min();
        if let (Some((_, _, file)), Some(root)) = (best, root) {
            return Some(FileLink { path: root.join(file), line, column });
        }
    }
    None
}

fn shorten_path(path: &str) -> String {
    if path.chars().count() <= MAX_PATH_LENGTH {
        return path.to_string();
    }
    let last = path.split('/').filter(|segment| !segment.is_empty()).next_back().unwrap_or_default();
    if last.chars().count() > MAX_PATH_LENGTH {
        format!("/…/{}…", last.chars().take(MAX_PATH_LENGTH - 1).collect::<String>())
    } else {
        format!("/…/{last}")
    }
}

/// What a link shows: the label the agent wrote, or for a bare address something readable.
pub fn text(href: &str, label: &str) -> String {
    let label_trimmed = label.trim();
    let bare = label_trimmed.is_empty() || label_trimmed == href.trim() || label_trimmed == decode(href.trim());
    if !bare {
        return label.to_string();
    }
    match target(href) {
        LinkTarget::GitHub(entity) => entity.reference(false),
        LinkTarget::Web { host, path } => format!("{host}{}", shorten_path(&path)),
        LinkTarget::Mail(address) => address,
        LinkTarget::File { path, line } => {
            let name = Path::new(&path).file_name().map_or(path.clone(), |name| name.to_string_lossy().into_owned());
            match line {
                Some(line) => format!("{name}:{line}"),
                None => name,
            }
        }
    }
}

/// Where plain text, such as command output, holds web addresses (`linked-text.tsx`), trailing
/// punctuation left out.
pub fn web_urls(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut from = 0;
    while let Some(found) = ["https://", "http://"].iter().filter_map(|scheme| text[from..].find(scheme)).min() {
        let start = from + found;
        let end = text[start..].find(|c: char| c.is_whitespace() || "<>\"'`".contains(c)).map_or(text.len(), |offset| start + offset);
        let url = text[start..end].trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '}']);
        if url.len() > "https://".len() {
            ranges.push(start..start + url.len());
        }
        from = end.max(start + 1);
    }
    ranges
}

/// The GitHub `owner/repo` of the project's `origin` remote, read from its git config.
pub fn project_repository(root: &Path) -> Option<(String, String)> {
    let config = std::fs::read_to_string(git_dir(root)?.join("config")).ok()?;
    let mut in_origin = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line == "[remote \"origin\"]";
        } else if in_origin && let Some(url) = line.strip_prefix("url").map(str::trim_start).and_then(|rest| rest.strip_prefix('=')) {
            return parse_repository_url(url.trim());
        }
    }
    None
}

fn git_dir(root: &Path) -> Option<PathBuf> {
    let dot_git = root.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    let pointer = std::fs::read_to_string(&dot_git).ok()?;
    let dir = PathBuf::from(pointer.trim().strip_prefix("gitdir:")?.trim());
    let dir = if dir.is_absolute() { dir } else { root.join(dir) };
    // A worktree's config lives in the main repository.
    let common = std::fs::read_to_string(dir.join("commondir")).ok().map(|common| dir.join(common.trim()));
    Some(common.unwrap_or(dir))
}

fn parse_repository_url(url: &str) -> Option<(String, String)> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("https://www.github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, repo) = rest.split_once('/')?;
    (!owner.is_empty() && !repo.is_empty() && !repo.contains('/')).then(|| (owner.to_string(), repo.to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn non_ascii_hrefs_do_not_panic() {
        let _ = super::target("çalışma.md");
        let _ = super::target("src/日本.rs");
    }

    use super::*;

    #[test]
    fn reads_github_links() {
        assert_eq!(
            parse_github("https://github.com/athasdev/athas/pull/12/files"),
            Some(GitHubEntity::PullRequest { owner: "athasdev".into(), repo: "athas".into(), number: 12 })
        );
        assert_eq!(text("https://github.com/athasdev/athas/issues/7", "https://github.com/athasdev/athas/issues/7"), "athasdev/athas#7");
        assert_eq!(text("https://github.com/a/b/actions/runs/99", ""), "a/b run 99");
        assert_eq!(text("https://github.com/a/b/commit/0123456789abcdef", ""), "a/b@0123456");
        assert_eq!(parse_github("https://gitlab.com/a/b/pull/1"), None);
        let entity = parse_github("https://github.com/AthasDev/Athas/pull/3").unwrap();
        assert!(entity.belongs_to(&("athasdev".into(), "athas".into())));
        assert_eq!(entity.reference(true), "#3");
    }

    #[test]
    fn relative_and_line_anchored_links_resolve_to_project_files() {
        let files: Vec<String> = ["src/main.rs", "crates/ui/src/main.rs", "docs/Guide.md"].map(String::from).to_vec();
        let root = Path::new("/p");
        let exists = |path: &Path| path == Path::new("/p/src/main.rs") || path == Path::new("/abs/x.rs");
        let link = |href: &str, label: &str| resolve_file_link(href, label, &files, Some(root), exists);
        assert_eq!(link("src/main.rs:12:3", ""), Some(FileLink { path: "/p/src/main.rs".into(), line: Some(12), column: Some(3) }));
        assert_eq!(link("./src/main.rs#L4-L9", "").map(|link| link.line), Some(Some(4)));
        assert_eq!(link("ui/src/main.rs#line-7", "").map(|link| (link.path, link.line)), Some(("/p/crates/ui/src/main.rs".into(), Some(7))));
        assert_eq!(link("guide.md", "").map(|link| link.path), Some("/p/docs/Guide.md".into()));
        assert_eq!(link("file:///abs/x.rs:2", "").map(|link| (link.path, link.line)), Some(("/abs/x.rs".into(), Some(2))));
        assert_eq!(link("#heading", "main.rs").map(|link| link.path), Some("/p/src/main.rs".into()));
        assert_eq!(link("https://athas.dev/main.rs", "main.rs"), None);
        assert_eq!(link("missing.rs", "nothing"), None);
    }

    #[test]
    fn bare_addresses_become_readable() {
        assert_eq!(text("https://www.athas.dev/docs/", "https://www.athas.dev/docs/"), "athas.dev/docs");
        assert_eq!(text("https://example.com/a/very/long/path/that/keeps/going/to/page.html", ""), "example.com/…/page.html");
        assert_eq!(text("mailto:hi@athas.dev?subject=x", "mailto:hi@athas.dev?subject=x"), "hi@athas.dev");
        assert_eq!(text("/p/src/main.rs:12:4", "/p/src/main.rs:12:4"), "main.rs:12");
        assert_eq!(text("file:///p/src/lib.rs#L3-L9", ""), "lib.rs:3");
        assert_eq!(text("https://athas.dev", "the site"), "the site");
    }

    #[test]
    fn finds_web_addresses_in_output() {
        let text = "Local: http://localhost:5173/, docs at (https://athas.dev/docs). Done";
        let urls: Vec<&str> = web_urls(text).into_iter().map(|range| &text[range]).collect();
        assert_eq!(urls, ["http://localhost:5173/", "https://athas.dev/docs"]);
        assert!(web_urls("no links http:// here").is_empty());
    }

    #[test]
    fn finds_the_project_repository() {
        assert_eq!(parse_repository_url("git@github.com:athasdev/athas.git"), Some(("athasdev".into(), "athas".into())));
        assert_eq!(parse_repository_url("https://github.com/athasdev/athas"), Some(("athasdev".into(), "athas".into())));
        assert_eq!(parse_repository_url("https://gitlab.com/a/b"), None);
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/config"), "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = git@github.com:athasdev/athas.git\n").unwrap();
        assert_eq!(project_repository(dir.path()), Some(("athasdev".into(), "athas".into())));
    }
}
