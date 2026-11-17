//! Source control for remote projects: `git` run over SSH exec in the repository on the server,
//! with the same operations and shapes as the git panel's `GitRepository` (status, diff stats,
//! staging, commits, branches, history, stashes, fetch/pull/push).

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{Result, anyhow};

use crate::{
    fs::{connection, remote_path},
    manager::Connection,
    path::{RemotePath, shell_quote},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
    pub staged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffStat {
    pub path: String,
    pub staged: bool,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WorkingTree {
    pub branch: String,
    pub head: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<StatusEntry>,
    pub stats: Vec<DiffStat>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub hash: String,
    pub summary: String,
    pub author: String,
    /// `YYYY-MM-DD`.
    pub date: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stash {
    pub index: usize,
    pub message: String,
    /// ISO 8601.
    pub date: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteOp {
    Fetch,
    Pull,
    Push,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Checkout {
    Switched,
    Blocked(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StashAction {
    Apply,
    Pop,
    Drop,
}

/// Runs `git` somewhere: over SSH here, through `wsl.exe` in the `wsl` crate.
pub trait GitRunner: Send + Sync {
    /// Runs `git <arguments>` in `directory`, returning stdout, or stderr as the error.
    fn run(&self, directory: &str, arguments: &[&str], stdin: Option<&[u8]>) -> Result<String>;
}

struct SshRunner(Arc<Connection>);

impl GitRunner for SshRunner {
    fn run(&self, directory: &str, arguments: &[&str], stdin: Option<&[u8]>) -> Result<String> {
        self.0.exec(&git_command(directory, arguments), stdin)?.into_result()
    }
}

/// A repository on another machine (a server or a WSL distribution), driven by `git` commands.
pub struct RemoteGit {
    /// The working tree's root as the workbench names it (`remote://<id>/<top level>`).
    root: PathBuf,
    /// The top level on that machine.
    directory: String,
    runner: Arc<dyn GitRunner>,
    /// Index and working tree changes run one at a time, so they never race for `index.lock`.
    lock: Mutex<()>,
}

/// The `git` invocation for `arguments` in `directory`, quoted for the remote shell. Prompts are
/// off: there is no terminal to type a credential into.
pub fn git_command(directory: &str, arguments: &[&str]) -> String {
    let mut command = format!("GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 git -C {} -c core.quotepath=off", shell_quote(directory));
    for argument in arguments {
        command.push(' ');
        command.push_str(&shell_quote(argument));
    }
    command
}

impl RemoteGit {
    /// The repository that contains `path` (a `remote://` path), if any.
    pub fn discover(path: &Path) -> Option<Self> {
        let path = remote_path(path).ok()?;
        let runner: Arc<dyn GitRunner> = Arc::new(SshRunner(connection(&path).ok()?));
        let top = runner.run(&path.path, &["rev-parse", "--show-toplevel"], None).ok()?;
        let root = RemotePath::new(path.connection_id, top.trim());
        Some(Self::with_runner(root.to_path_buf(), root.path, runner))
    }

    /// A repository at `directory` on the runner's machine, named `root` in the workbench.
    pub fn with_runner(root: PathBuf, directory: String, runner: Arc<dyn GitRunner>) -> Self {
        Self { root, directory, runner, lock: Mutex::new(()) }
    }

    /// Runs `git init` in a remote folder, on `initial_branch` when one is named.
    pub fn init(path: &Path, initial_branch: Option<&str>) -> Result<()> {
        let path = remote_path(path)?;
        Self::init_with(&SshRunner(connection(&path)?), &path.path, initial_branch)
    }

    /// `git init` in `directory` through `runner`. The branch is set with `symbolic-ref`, which
    /// works on servers whose git predates `init -b`.
    pub fn init_with(runner: &dyn GitRunner, directory: &str, initial_branch: Option<&str>) -> Result<()> {
        runner.run(directory, &["init", "-q"], None)?;
        if let Some(branch) = initial_branch.map(str::trim).filter(|branch| !branch.is_empty()) {
            runner.run(directory, &["check-ref-format", "--branch", branch], None).map_err(|_| anyhow!("Invalid branch name {branch:?}"))?;
            runner.run(directory, &["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")], None)?;
        }
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn git_with(&self, arguments: &[&str], stdin: Option<&[u8]>) -> Result<String> {
        self.runner.run(&self.directory, arguments, stdin)
    }

    fn git(&self, arguments: &[&str]) -> Result<String> {
        self.git_with(arguments, None)
    }

    fn locked<T>(&self, work: impl FnOnce() -> Result<T>) -> Result<T> {
        let _guard = self.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        work()
    }

    pub fn status(&self) -> Result<WorkingTree> {
        let status = self.locked(|| self.git(&["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]))?;
        let mut tree = parse_status(&status);
        // Stats are decoration; a repository without commits still shows.
        for staged in [false, true] {
            let mut arguments = vec!["diff", "--numstat", "-z"];
            if staged {
                arguments.push("--cached");
            }
            if let Ok(output) = self.git(&arguments) {
                tree.stats.extend(parse_numstat(&output, staged));
            }
        }
        Ok(tree)
    }

    pub fn branches(&self) -> Result<Vec<String>> {
        let output = self.git(&["for-each-ref", "--format=%(refname:short)", "refs/heads"])?;
        Ok(output.lines().filter(|line| !line.is_empty()).map(str::to_string).collect())
    }

    pub fn log(&self, skip: usize, limit: usize) -> Result<Vec<Commit>> {
        let skip = format!("--skip={skip}");
        let limit = format!("--max-count={limit}");
        // A repository without commits has no HEAD to walk; that is an empty history.
        let Ok(output) = self.git(&["log", &skip, &limit, "--date=short", "--format=%H%x1f%s%x1f%an%x1f%ad%x1e"]) else {
            return Ok(Vec::new());
        };
        Ok(parse_log(&output))
    }

    pub fn stashes(&self) -> Result<Vec<Stash>> {
        Ok(parse_stashes(&self.git(&["stash", "list", "--format=%gd%x1f%gs%x1f%cI%x1e"])?))
    }

    pub fn set_staged(&self, paths: &[String], staged: bool) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut arguments = if staged { vec!["add", "-A", "--"] } else { vec!["reset", "-q", "--"] };
        arguments.extend(paths.iter().map(String::as_str));
        self.locked(|| match self.git(&arguments) {
            Ok(_) => Ok(()),
            // Before the first commit there is no HEAD to reset to.
            Err(_) if !staged => {
                let mut arguments = vec!["rm", "-q", "--cached", "-r", "--"];
                arguments.extend(paths.iter().map(String::as_str));
                self.git(&arguments).map(|_| ())
            }
            Err(error) => Err(error),
        })
    }

    pub fn discard(&self, paths: &[String]) -> Result<()> {
        self.locked(|| {
            for path in paths {
                if self.git(&["checkout", "-q", "--", path]).is_err() {
                    self.git(&["clean", "-fdq", "--", path])?;
                }
            }
            Ok(())
        })
    }

    pub fn discard_all(&self) -> Result<()> {
        self.locked(|| {
            self.git(&["checkout", "-q", "--", "."]).ok();
            self.git(&["clean", "-fdq"]).map(|_| ())
        })
    }

    pub fn commit(&self, message: &str) -> Result<()> {
        self.locked(|| self.git_with(&["commit", "-q", "-F", "-"], Some(message.as_bytes())).map(|_| ()))
    }

    pub fn checkout(&self, branch: &str) -> Result<Checkout> {
        self.locked(|| match self.git(&["checkout", "-q", branch]) {
            Ok(_) => Ok(Checkout::Switched),
            Err(error) => {
                let message = error.to_string();
                if message.contains("would be overwritten") || message.contains("commit your changes or stash them") {
                    Ok(Checkout::Blocked(message))
                } else {
                    Err(error)
                }
            }
        })
    }

    pub fn create_branch(&self, name: &str, from: Option<&str>) -> Result<()> {
        let mut arguments = vec!["checkout", "-q", "-b", name];
        arguments.extend(from);
        self.locked(|| self.git(&arguments).map(|_| ()))
    }

    pub fn delete_branch(&self, name: &str) -> Result<()> {
        self.locked(|| self.git(&["branch", "-d", name]).map(|_| ()))
    }

    pub fn stash(&self, message: Option<&str>, paths: Option<Vec<String>>) -> Result<()> {
        let mut arguments = vec!["stash", "push", "-q", "--include-untracked"];
        if let Some(message) = message {
            arguments.extend(["-m", message]);
        }
        if let Some(paths) = paths.as_ref() {
            arguments.push("--");
            arguments.extend(paths.iter().map(String::as_str));
        }
        self.locked(|| self.git(&arguments).map(|_| ()))
    }

    pub fn stash_action(&self, action: StashAction, index: usize) -> Result<()> {
        let stash = format!("stash@{{{index}}}");
        let verb = match action {
            StashAction::Apply => "apply",
            StashAction::Pop => "pop",
            StashAction::Drop => "drop",
        };
        self.locked(|| self.git(&["stash", verb, "-q", &stash]).map(|_| ()))
    }

    pub fn remote(&self, op: RemoteOp, pull_rebase: bool) -> Result<()> {
        match op {
            RemoteOp::Fetch => self.git(&["fetch", "-q", "origin"]),
            RemoteOp::Push => self.git(&["push", "-q", "origin", "HEAD"]),
            RemoteOp::Pull => self.locked(|| {
                self.git(&["pull", "-q", if pull_rebase { "--rebase" } else { "--no-rebase" }, "origin"])
            }),
        }
        .map(|_| ())
        .map_err(|error| anyhow!("git {:?} failed: {error}", op))
    }
}

fn change(code: char) -> Option<FileStatus> {
    match code {
        'M' | 'T' | 'U' => Some(FileStatus::Modified),
        'A' | 'C' => Some(FileStatus::Added),
        'D' => Some(FileStatus::Deleted),
        'R' => Some(FileStatus::Renamed),
        _ => None,
    }
}

/// Reads `git status --porcelain=v2 --branch -z`.
pub fn parse_status(output: &str) -> WorkingTree {
    let mut tree = WorkingTree::default();
    let mut records = output.split('\0');
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => tree.head = Some(value.to_string()),
                "branch.head" => tree.branch = if value == "(detached)" { "HEAD".into() } else { value.to_string() },
                "branch.ab" => {
                    for part in value.split_whitespace() {
                        if let Some(ahead) = part.strip_prefix('+') {
                            tree.ahead = ahead.parse().unwrap_or(0);
                        } else if let Some(behind) = part.strip_prefix('-') {
                            tree.behind = behind.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let (kind, fields) = match record.split_once(' ') {
            Some(split) => split,
            None => continue,
        };
        let (xy, path) = match kind {
            "?" => {
                tree.files.push(StatusEntry { path: fields.to_string(), status: FileStatus::Untracked, staged: false });
                continue;
            }
            // XY sub mH mI mW hH hI path
            "1" => match fields.splitn(8, ' ').collect::<Vec<_>>()[..] {
                [xy, _, _, _, _, _, _, path] => (xy, path),
                _ => continue,
            },
            // XY sub mH mI mW hH hI Xscore path, then the original path as its own record.
            "2" => {
                records.next();
                match fields.splitn(9, ' ').collect::<Vec<_>>()[..] {
                    [xy, _, _, _, _, _, _, _, path] => (xy, path),
                    _ => continue,
                }
            }
            // XY sub m1 m2 m3 mW h1 h2 h3 path: a conflict, shown as an unstaged change.
            "u" => match fields.splitn(10, ' ').collect::<Vec<_>>()[..] {
                [_, _, _, _, _, _, _, _, _, path] => {
                    tree.files.push(StatusEntry { path: path.to_string(), status: FileStatus::Modified, staged: false });
                    continue;
                }
                _ => continue,
            },
            _ => continue,
        };
        let mut codes = xy.chars();
        let (index, worktree) = (codes.next().unwrap_or('.'), codes.next().unwrap_or('.'));
        if let Some(status) = change(index) {
            tree.files.push(StatusEntry { path: path.to_string(), status, staged: true });
        }
        if let Some(status) = change(worktree) {
            tree.files.push(StatusEntry { path: path.to_string(), status, staged: false });
        }
    }
    tree
}

/// Reads `git diff --numstat -z`; a rename's record names the new path.
pub fn parse_numstat(output: &str, staged: bool) -> Vec<DiffStat> {
    let mut stats = Vec::new();
    let mut records = output.split('\0');
    while let Some(record) = records.next() {
        let mut fields = record.splitn(3, '\t');
        let (Some(additions), Some(deletions), Some(path)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        let path = if path.is_empty() {
            records.next();
            match records.next() {
                Some(path) => path,
                None => continue,
            }
        } else {
            path
        };
        stats.push(DiffStat {
            path: path.to_string(),
            staged,
            additions: additions.parse().unwrap_or(0),
            deletions: deletions.parse().unwrap_or(0),
        });
    }
    stats
}

pub fn parse_log(output: &str) -> Vec<Commit> {
    output
        .split('\x1e')
        .filter_map(|record| {
            let mut fields = record.trim_start_matches('\n').split('\x1f');
            Some(Commit {
                hash: fields.next().filter(|hash| !hash.is_empty())?.to_string(),
                summary: fields.next()?.to_string(),
                author: fields.next()?.to_string(),
                date: fields.next()?.trim().to_string(),
            })
        })
        .collect()
}

pub fn parse_stashes(output: &str) -> Vec<Stash> {
    output
        .split('\x1e')
        .filter_map(|record| {
            let mut fields = record.trim_start_matches('\n').split('\x1f');
            let index = fields.next()?.strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
            let message = fields.next()?;
            // `On main: wip` for a named stash, `WIP on main: <hash> <subject>` otherwise.
            let message = message.split_once(": ").filter(|(prefix, _)| prefix.starts_with("On ")).map_or(message, |(_, rest)| rest);
            Some(Stash { index, message: message.to_string(), date: fields.next()?.trim().to_string() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_status() {
        let output = [
            "# branch.oid 1234abcd",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 M. N... 100644 100644 100644 aaa bbb src/staged.rs",
            "1 .M N... 100644 100644 100644 aaa bbb src/with space.rs",
            "1 MM N... 100644 100644 100644 aaa bbb both.rs",
            "1 A. N... 000000 100644 100644 000 bbb added.rs",
            "1 .D N... 100644 100644 000000 aaa aaa gone.rs",
            "2 R. N... 100644 100644 100644 aaa aaa R100 new name.rs",
            "old name.rs",
            "u UU N... 100644 100644 100644 100644 a b c conflict.rs",
            "? notes.txt",
            "",
        ]
        .join("\0");
        let tree = parse_status(&output);
        assert_eq!(tree.branch, "main");
        assert_eq!(tree.head.as_deref(), Some("1234abcd"));
        assert_eq!((tree.ahead, tree.behind), (2, 1));
        let entry = |path: &str, status, staged| StatusEntry { path: path.into(), status, staged };
        assert_eq!(
            tree.files,
            vec![
                entry("src/staged.rs", FileStatus::Modified, true),
                entry("src/with space.rs", FileStatus::Modified, false),
                entry("both.rs", FileStatus::Modified, true),
                entry("both.rs", FileStatus::Modified, false),
                entry("added.rs", FileStatus::Added, true),
                entry("gone.rs", FileStatus::Deleted, false),
                entry("new name.rs", FileStatus::Renamed, true),
                entry("conflict.rs", FileStatus::Modified, false),
                entry("notes.txt", FileStatus::Untracked, false),
            ]
        );
        let empty = parse_status("# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!((empty.head, empty.branch.as_str()), (None, "HEAD"));
    }

    #[test]
    fn parses_numstat_with_renames_and_binaries() {
        let output = "3\t1\tsrc/a.rs\0-\t-\timage.png\x000\t2\t\0old.rs\0new.rs\0";
        let stats = parse_numstat(output, true);
        assert_eq!(stats.len(), 3);
        assert_eq!((stats[0].path.as_str(), stats[0].additions, stats[0].deletions), ("src/a.rs", 3, 1));
        assert_eq!((stats[1].additions, stats[1].deletions), (0, 0));
        assert_eq!(stats[2].path, "new.rs");
        assert!(stats.iter().all(|stat| stat.staged));
    }

    #[test]
    fn parses_log_and_stashes() {
        let log = parse_log("abc\x1fFix: a | b\x1fAda\x1f2026-11-10\x1e\ndef\x1fFirst\x1fGrace\x1f2026-11-01\x1e\n");
        assert_eq!(log.len(), 2);
        assert_eq!(log[0], Commit { hash: "abc".into(), summary: "Fix: a | b".into(), author: "Ada".into(), date: "2026-11-10".into() });
        let stashes = parse_stashes("stash@{0}\x1fOn main: wip\x1f2026-11-10T10:00:00+01:00\x1e\nstash@{1}\x1fWIP on main: abc First\x1f2026-11-09T10:00:00Z\x1e\n");
        assert_eq!(stashes[0], Stash { index: 0, message: "wip".into(), date: "2026-11-10T10:00:00+01:00".into() });
        assert_eq!((stashes[1].index, stashes[1].message.as_str()), (1, "WIP on main: abc First"));
    }

    #[test]
    fn quotes_git_commands() {
        assert_eq!(
            git_command("/srv/my app", &["commit", "-m", "it's done"]),
            "GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 git -C '/srv/my app' -c core.quotepath=off 'commit' '-m' 'it'\\''s done'"
        );
    }

    /// Runs `git` through `sh` on this machine, exactly as the SSH runner sends it to a server.
    #[cfg(unix)]
    struct ShellRunner;

    #[cfg(unix)]
    impl GitRunner for ShellRunner {
        fn run(&self, directory: &str, arguments: &[&str], stdin: Option<&[u8]>) -> Result<String> {
            use std::io::Write;
            let mut child = std::process::Command::new("sh")
                .arg("-c")
                .arg(git_command(directory, arguments))
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()?;
            child.stdin.take().unwrap().write_all(stdin.unwrap_or_default())?;
            let output = child.wait_with_output()?;
            crate::session::ExecOutput { status: output.status.code().unwrap_or(1), stdout: output.stdout, stderr: output.stderr }
                .into_result()
        }
    }

    #[cfg(unix)]
    #[test]
    fn initializes_on_the_named_branch() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        RemoteGit::init_with(&ShellRunner, &root, Some(" trunk ")).unwrap();
        assert_eq!(ShellRunner.run(&root, &["symbolic-ref", "HEAD"], None).unwrap().trim(), "refs/heads/trunk");
        let other = tempfile::tempdir().unwrap();
        let other_root = other.path().to_string_lossy().into_owned();
        assert!(RemoteGit::init_with(&ShellRunner, &other_root, Some("bad..name")).is_err());
        RemoteGit::init_with(&ShellRunner, &other_root, None).unwrap();
        assert!(other.path().join(".git").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn drives_a_real_repository() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let runner = Arc::new(ShellRunner);
        for arguments in [
            &["init", "-q", "-b", "main"][..],
            &["config", "user.name", "Test"],
            &["config", "user.email", "test@example.com"],
            &["config", "commit.gpgsign", "false"],
        ] {
            runner.run(&root, arguments, None).unwrap();
        }
        let repo = RemoteGit::with_runner(RemotePath::new("box", &root).to_path_buf(), root.clone(), runner);
        std::fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        repo.set_staged(&["a.txt".into()], true).unwrap();
        repo.commit("First\n\nBody").unwrap();
        assert_eq!(repo.log(0, 5).unwrap()[0].summary, "First");

        std::fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(dir.path().join("b.txt"), "new\n").unwrap();
        let tree = repo.status().unwrap();
        assert_eq!(tree.branch, "main");
        assert!(tree.head.is_some());
        assert!(tree.files.contains(&StatusEntry { path: "a.txt".into(), status: FileStatus::Modified, staged: false }));
        assert!(tree.files.contains(&StatusEntry { path: "b.txt".into(), status: FileStatus::Untracked, staged: false }));
        assert!(tree.stats.iter().any(|stat| stat.path == "a.txt" && stat.additions == 1 && !stat.staged));
        repo.set_staged(&["b.txt".into()], true).unwrap();
        assert!(repo.status().unwrap().files.contains(&StatusEntry { path: "b.txt".into(), status: FileStatus::Added, staged: true }));
        repo.set_staged(&["b.txt".into()], false).unwrap();

        repo.create_branch("feature", None).unwrap();
        assert_eq!(repo.status().unwrap().branch, "feature");
        let mut branches = repo.branches().unwrap();
        branches.sort();
        assert_eq!(branches, ["feature", "main"]);
        repo.stash(Some("wip"), None).unwrap();
        let stashes = repo.stashes().unwrap();
        assert_eq!((stashes.len(), stashes[0].message.as_str()), (1, "wip"));
        assert!(repo.status().unwrap().files.is_empty());
        assert_eq!(repo.checkout("main").unwrap(), Checkout::Switched);
        repo.stash_action(StashAction::Pop, 0).unwrap();
        assert!(repo.stashes().unwrap().is_empty());
        repo.delete_branch("feature").unwrap();
        assert_eq!(repo.branches().unwrap(), ["main"]);

        repo.discard(&["a.txt".into(), "b.txt".into()]).unwrap();
        assert!(repo.status().unwrap().files.is_empty());
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "one\n");
    }
}
