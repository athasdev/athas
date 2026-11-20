//! Athas's log file (`logger.rs` and `commands/app_logs.rs`): `log` records from Athas's crates at
//! info level and from everything else at warn, written to `Athas.log` in the OS's logs folder for
//! the app. Launched from the Dock or Finder, stderr goes there too, so `eprintln!` messages and
//! panics land in the same file.

use std::{
    fs::{self, File, OpenOptions},
    io::{IsTerminal as _, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use log::{LevelFilter, Log, Metadata, Record};

const APP_ID: &str = paths::APP_ID;
const LOG_FILE: &str = "Athas.log";
/// A log past this size at launch is set aside and a new one started.
const MAX_LOG_BYTES_AT_LAUNCH: u64 = 5_000_000;
/// Set-aside logs kept besides the current one.
const KEPT_OLD_LOGS: usize = 4;
/// Opening the log reads at most this much of its end.
const MAX_READ_BYTES: u64 = 1_000_000;

/// Where Athas keeps its logs: `~/Library/Logs/dev.athas.gpui` on macOS, the app's local data
/// folder elsewhere.
pub fn logs_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        dirs::home_dir().map(|home| home.join("Library").join("Logs").join(APP_ID))
    } else {
        dirs::data_local_dir().map(|dir| dir.join(APP_ID).join("logs"))
    }
}

/// When the process started, as near as Athas can tell: the first of [`init`] and
/// [`startup_milestone`].
fn started_at() -> std::time::Instant {
    static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    *STARTED.get_or_init(std::time::Instant::now)
}

fn milestone_line(milestone: &str, elapsed: std::time::Duration) -> String {
    format!("[startup] {milestone} elapsedMs={}", elapsed.as_millis())
}

/// A startup timing mark in the log (`recordStartupMilestone`), once per milestone:
/// `[startup] workbench:first-frame elapsedMs=412`.
pub fn startup_milestone(milestone: &str) {
    static RECORDED: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let elapsed = started_at().elapsed();
    let Ok(mut recorded) = RECORDED.lock() else { return };
    if recorded.iter().any(|known| known == milestone) {
        return;
    }
    recorded.push(milestone.to_string());
    log::info!("{}", milestone_line(milestone, elapsed));
}

/// Starts writing the log. `ATHAS_LOG` (`error`, `warn`, `info`, `debug`, `trace`, `off`) sets
/// the level of Athas's own records. Returns the log's path, or `None` when it could not be opened.
pub fn init() -> Option<PathBuf> {
    started_at();
    let dir = logs_dir()?;
    let level = std::env::var("ATHAS_LOG").ok().and_then(|value| value.parse().ok()).unwrap_or(default_level());
    match init_in(&dir, level) {
        Ok(path) => Some(path),
        Err(error) => {
            eprintln!("athas: could not open the log in {}: {error}", dir.display());
            None
        }
    }
}

fn default_level() -> LevelFilter {
    if cfg!(debug_assertions) { LevelFilter::Debug } else { LevelFilter::Info }
}

fn init_in(dir: &Path, level: LevelFilter) -> std::io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = dir.join(LOG_FILE);
    rotate(dir, &path);
    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    let echo = std::io::stderr().is_terminal();
    if !echo {
        redirect_stderr(&file);
    }
    let logger = FileLogger { level, file: Mutex::new(file), echo };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(level.max(LevelFilter::Warn));
    }
    log::info!("Athas {} started", env!("CARGO_PKG_VERSION"));
    Ok(path)
}

/// Sets a large log aside under a dated name and drops the oldest set-aside ones.
fn rotate(dir: &Path, path: &Path) {
    if fs::metadata(path).map_or(true, |metadata| metadata.len() <= MAX_LOG_BYTES_AT_LAUNCH) {
        return;
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    fs::rename(path, dir.join(format!("Athas_{stamp}.log"))).ok();
    let mut old: Vec<(PathBuf, std::time::SystemTime)> = log_files(dir)
        .into_iter()
        .filter(|(old, _)| old.file_name().is_some_and(|name| name != LOG_FILE))
        .collect();
    old.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    for (stale, _) in old.into_iter().skip(KEPT_OLD_LOGS) {
        fs::remove_file(stale).ok();
    }
}

#[cfg(unix)]
fn redirect_stderr(file: &File) {
    use std::os::fd::AsRawFd as _;
    // SAFETY: both descriptors are open; dup2 replaces fd 2 atomically.
    unsafe {
        libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO);
    }
}

#[cfg(not(unix))]
fn redirect_stderr(_: &File) {}

struct FileLogger {
    level: LevelFilter,
    file: Mutex<File>,
    /// Also prints to the terminal Athas was started from.
    echo: bool,
}

impl FileLogger {
    fn level_for(&self, target: &str, file: Option<&str>) -> LevelFilter {
        if is_athas_record(target, file) { self.level } else { LevelFilter::Warn }
    }
}

/// Records from this workspace's crates (built from relative paths) and from Athas's own crates
/// it links by path.
fn is_athas_record(target: &str, file: Option<&str>) -> bool {
    target.starts_with("athas") || file.is_some_and(|file| file.starts_with("crates/") || file.starts_with("crates\\"))
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level.max(LevelFilter::Warn)
    }

    fn log(&self, record: &Record) {
        if record.level() > self.level_for(record.target(), record.file()) {
            return;
        }
        let line = format_line(&chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(), record);
        if let Ok(mut file) = self.file.lock() {
            file.write_all(line.as_bytes()).ok();
        }
        if self.echo {
            std::io::stderr().write_all(line.as_bytes()).ok();
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            file.flush().ok();
        }
    }
}

fn format_line(time: &str, record: &Record) -> String {
    format!("[{time}] [{}] [{}]: {}\n", record.level(), record.target(), record.args())
}

/// The end of the newest log, opened by "Developer: Open Athas Log".
#[derive(Clone, Debug, PartialEq)]
pub struct LogFile {
    pub path: PathBuf,
    pub content: String,
    /// The last line reporting an error, else the last line (0-based).
    pub target_line: usize,
    /// Only the end of a long log was read.
    pub truncated: bool,
}

pub fn read_latest() -> Result<LogFile, String> {
    let dir = logs_dir().ok_or("No logs folder on this system")?;
    read_latest_in(&dir)
}

pub fn read_latest_in(dir: &Path) -> Result<LogFile, String> {
    let path = latest_log_file(dir).ok_or_else(|| format!("No Athas log file found in {}", dir.display()))?;
    let (content, truncated) = read_log_tail(&path)?;
    let target_line = find_last_error_line(&content).unwrap_or_else(|| content.lines().count().saturating_sub(1));
    Ok(LogFile { path, content, target_line, truncated })
}

/// The `.log` file in `dir` changed last.
pub fn latest_log_file(dir: &Path) -> Option<PathBuf> {
    log_files(dir).into_iter().max_by_key(|(_, modified)| *modified).map(|(path, _)| path)
}

fn log_files(dir: &Path) -> Vec<(PathBuf, std::time::SystemTime)> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("log") {
                return None;
            }
            let modified = entry.metadata().and_then(|metadata| metadata.modified()).ok()?;
            Some((path, modified))
        })
        .collect()
}

/// At most the last [`MAX_READ_BYTES`], starting at a whole line.
fn read_log_tail(path: &Path) -> Result<(String, bool), String> {
    let mut file = File::open(path).map_err(|error| format!("Failed to open Athas log {}: {error}", path.display()))?;
    let length = file.metadata().map_err(|error| format!("Failed to read Athas log metadata: {error}"))?.len();
    let start = length.saturating_sub(MAX_READ_BYTES);
    let truncated = start > 0;
    file.seek(SeekFrom::Start(start)).map_err(|error| format!("Failed to seek Athas log: {error}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| format!("Failed to read Athas log: {error}"))?;
    if truncated && let Some(newline) = bytes.iter().position(|byte| *byte == b'\n') {
        bytes.drain(..=newline);
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

fn find_last_error_line(content: &str) -> Option<usize> {
    content
        .lines()
        .enumerate()
        .filter(|(_, line)| {
            let lower = line.to_ascii_lowercase();
            lower.contains("[error]") || lower.contains(" error") || lower.contains("failed")
        })
        .map(|(index, _)| index)
        .last()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_marks_read_as_the_original_logs_them() {
        assert_eq!(milestone_line("workbench:first-frame", std::time::Duration::from_millis(412)), "[startup] workbench:first-frame elapsedMs=412");
        startup_milestone("test:once");
        startup_milestone("test:once");
    }
    use std::time::{Duration, SystemTime};

    fn set_modified(path: &Path, seconds_ago: u64) {
        let file = File::options().append(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(seconds_ago)).unwrap();
    }

    #[test]
    fn reads_the_newest_log_at_its_last_error() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Athas_old.log"), "[ERROR] old\n").unwrap();
        fs::write(dir.path().join("notes.txt"), "not a log").unwrap();
        fs::write(dir.path().join(LOG_FILE), "[INFO] start\n[ERROR] [lsp]: boom\n[INFO] later\n").unwrap();
        set_modified(&dir.path().join("Athas_old.log"), 600);

        let log = read_latest_in(dir.path()).unwrap();
        assert_eq!(log.path, dir.path().join(LOG_FILE));
        assert_eq!(log.target_line, 1);
        assert!(!log.truncated);
    }

    #[test]
    fn without_errors_the_last_line_is_the_target() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(LOG_FILE), "one\ntwo\nthree\n").unwrap();
        assert_eq!(read_latest_in(dir.path()).unwrap().target_line, 2);
        assert!(read_latest_in(&dir.path().join("missing")).is_err());
    }

    #[test]
    fn long_logs_are_read_from_a_whole_line_near_the_end() {
        let dir = tempfile::tempdir().unwrap();
        let line = "x".repeat(99) + "\n";
        fs::write(dir.path().join(LOG_FILE), line.repeat(20_000) + "tail failed\n").unwrap();
        let log = read_latest_in(dir.path()).unwrap();
        assert!(log.truncated);
        assert!(log.content.len() <= MAX_READ_BYTES as usize);
        assert!(log.content.starts_with('x') && log.content.lines().next().unwrap().len() == 99);
        assert_eq!(log.content.lines().nth(log.target_line), Some("tail failed"));
    }

    #[test]
    fn a_large_log_is_set_aside_at_launch_keeping_a_few() {
        let dir = tempfile::tempdir().unwrap();
        for (index, age) in [500, 400, 300, 200, 100].into_iter().enumerate() {
            let old = dir.path().join(format!("Athas_{index}.log"));
            fs::write(&old, "old").unwrap();
            set_modified(&old, age);
        }
        let path = dir.path().join(LOG_FILE);
        fs::write(&path, vec![b'a'; MAX_LOG_BYTES_AT_LAUNCH as usize + 1]).unwrap();
        rotate(dir.path(), &path);
        assert!(!path.exists());
        let old = log_files(dir.path());
        assert_eq!(old.len(), KEPT_OLD_LOGS);
        assert!(!dir.path().join("Athas_0.log").exists());

        fs::write(&path, "small").unwrap();
        rotate(dir.path(), &path);
        assert!(path.exists());
    }

    #[test]
    fn athas_records_are_told_apart_from_dependencies() {
        assert!(is_athas_record("editor::lsp", Some("crates/editor/src/lsp.rs")));
        assert!(is_athas_record("athas_project::watcher", Some("/Users/x/athas/crates/project/src/watcher/mod.rs")));
        assert!(!is_athas_record("wgpu_core", Some("/Users/x/.cargo/registry/src/wgpu-core/src/lib.rs")));
        assert!(!is_athas_record("notify", None));

        let line = format_line(
            "2026-11-11 10:00:00.000",
            &Record::builder().level(log::Level::Warn).target("editor").args(format_args!("slow save")).build(),
        );
        assert_eq!(line, "[2026-11-11 10:00:00.000] [WARN] [editor]: slow save\n");
    }
}
