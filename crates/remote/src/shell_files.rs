//! File access over plain SSH commands, for connections whose workspace access is SSH rather than
//! SFTP (`use_sftp: false` in Athas's `file_ops.rs`): listings through a POSIX `sh` script, reads
//! with `cat`, and writes through the locked text mutation script with the content on stdin.

use anyhow::{Result, anyhow, bail};
use athas_project::shell_file_mutations::{ShellTextMutation, TEXT_MUTATION_SCRIPT, TextExpectation};

use crate::{path::shell_quote, session::ExecOutput};

/// Runs a command on the server with optional stdin: [`crate::Connection::exec`], or a local
/// shell in tests.
pub type Run<'a> = &'a dyn Fn(&str, Option<&[u8]>) -> Result<ExecOutput>;

/// One entry of a shell listing (`RemoteFileEntry`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellEntry {
    pub name: String,
    pub path: String,
    /// A folder, or a symlink to one.
    pub is_dir: bool,
    pub size: u64,
    pub is_symlink: bool,
    pub target: Option<String>,
}

/// What `stat` found: kind, size and modification time in Unix seconds (0 when unknown).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShellStat {
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub mtime: u64,
}

const DIRECTORY_LIST_SCRIPT: &str = r#"set -eu
[ -d "$1" ] && [ -r "$1" ] && [ -x "$1" ] || { printf 'Directory is not readable.\n' >&2; exit 1; }
d=$1
while [ "${d%/}" != "$d" ]; do d=${d%/}; done
for p in "$d"/* "$d"/.[!.]* "$d"/..?*; do
  [ -e "$p" ] || [ -L "$p" ] || continue
  kind=f; [ ! -d "$p" ] || kind=d
  linked=false; target=
  if [ -L "$p" ]; then linked=true; target=$(readlink "$p"); fi
  size=0
  if [ -f "$p" ]; then size=$(wc -c < "$p" 2>/dev/null || printf 0); fi
  printf '%s\0%s\0%s\0%s\0%s\0%s\0' "${p##*/}" "$p" "$kind" "$size" "$linked" "$target"
done"#;

/// Nothing for a missing path; GNU `stat -c`, then BSD `stat -f`, for the time.
const STAT_SCRIPT: &str = r#"p=$1
[ -e "$p" ] || [ -L "$p" ] || exit 0
kind=f; [ ! -d "$p" ] || kind=d
linked=false; [ ! -L "$p" ] || linked=true
size=0
if [ -f "$p" ]; then size=$(wc -c < "$p" 2>/dev/null || printf 0); fi
mtime=$(stat -c %Y -- "$p" 2>/dev/null || stat -f %m -- "$p" 2>/dev/null || printf 0)
printf '%s\0%s\0%s\0%s\0' "$kind" "$size" "$linked" "$mtime""#;

const CREATE_FILE_SCRIPT: &str = r#"if [ -e "$1" ] || [ -L "$1" ]; then echo "$1 already exists" >&2; exit 1; fi; : > "$1""#;

fn script(script: &str, name: &str, arguments: &[&str]) -> String {
    let mut command = format!("sh -c {} {name}", shell_quote(script));
    for argument in arguments {
        command.push(' ');
        command.push_str(&shell_quote(argument));
    }
    command
}

/// The entries of `directory`, folders first, then by name ignoring case, as the SFTP listing.
pub fn list(run: Run, directory: &str) -> Result<Vec<ShellEntry>> {
    let directory = if directory.is_empty() { "/" } else { directory };
    let output = run(&script(DIRECTORY_LIST_SCRIPT, "athas-list-dir", &[directory]), None)?.into_result()?;
    let mut entries = parse_directory_entries(&output)?;
    sort_entries(&mut entries);
    Ok(entries)
}

fn parse_directory_entries(output: &str) -> Result<Vec<ShellEntry>> {
    let fields: Vec<&str> = output.split_terminator('\0').collect();
    if !fields.len().is_multiple_of(6) {
        bail!("Invalid remote directory listing.");
    }
    fields
        .chunks(6)
        .map(|entry| {
            let [name, path, kind, size, linked, target] = entry else { unreachable!("chunks of six") };
            Ok(ShellEntry {
                name: (*name).into(),
                path: (*path).into(),
                is_dir: *kind == "d",
                size: size.trim().parse::<u64>()?,
                is_symlink: *linked == "true",
                target: (!target.is_empty()).then(|| (*target).into()),
            })
        })
        .collect()
}

fn sort_entries(entries: &mut [ShellEntry]) {
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

/// `lstat` with a missing path as `None`; `is_dir` follows a symlink, as `[ -d ]` does.
pub fn stat(run: Run, path: &str) -> Result<Option<ShellStat>> {
    let output = run(&script(STAT_SCRIPT, "athas-stat", &[path]), None)?.into_result()?;
    let fields: Vec<&str> = output.split_terminator('\0').collect();
    match fields.as_slice() {
        [] => Ok(None),
        [kind, size, linked, mtime] => Ok(Some(ShellStat {
            is_dir: *kind == "d",
            is_symlink: *linked == "true",
            size: size.trim().parse()?,
            mtime: mtime.trim().parse().unwrap_or(0),
        })),
        _ => bail!("Invalid remote file status."),
    }
}

/// The file's bytes (`cat`), at most `limit` of them.
pub fn read(run: Run, path: &str, limit: u64) -> Result<Vec<u8>> {
    let output = run(&format!("cat -- {}", shell_quote(path)), None)?;
    if output.status != 0 {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!(if details.is_empty() { format!("reading {path} failed") } else { details }));
    }
    let mut bytes = output.stdout;
    bytes.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
    Ok(bytes)
}

/// Writes (`Some`) or deletes (`None`) the file while it still matches `expected`, staging the new
/// text beside it and renaming it over the target (`TEXT_MUTATION_SCRIPT`).
pub fn mutate(run: Run, path: &str, expected: TextExpectation<'_>, content: Option<&str>) -> Result<()> {
    let request = ShellTextMutation::new(path, expected, content).map_err(anyhow::Error::msg)?;
    let arguments: Vec<&str> = request.arguments.iter().map(String::as_str).collect();
    let output = run(&script(TEXT_MUTATION_SCRIPT, "athas-edit", &arguments), Some(&request.input))?;
    if output.status != 0 {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        bail!("{}", if details.is_empty() { "Remote file update failed.".to_string() } else { details });
    }
    Ok(())
}

/// Creates an empty file, failing when the path exists.
pub fn create_file(run: Run, path: &str) -> Result<()> {
    run(&script(CREATE_FILE_SCRIPT, "athas", &[path]), None)?.into_result().map(|_| ())
}

/// The folder commands start in: the remote user's home.
pub fn home(run: Run) -> Result<String> {
    let home = run("pwd", None)?.into_result()?.trim_end_matches(['\r', '\n']).to_string();
    if home.is_empty() { bail!("The remote home folder is unknown.") } else { Ok(home) }
}

#[cfg(all(test, unix))]
mod tests {
    use std::{fs, os::unix::fs::symlink, path::Path, process::Command};

    use super::*;

    fn local(command: &str, stdin: Option<&[u8]>) -> Result<ExecOutput> {
        use std::io::Write;
        let mut child = Command::new("sh")
            .args(["-c", command])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let mut input = child.stdin.take().expect("stdin");
        if let Some(stdin) = stdin {
            input.write_all(stdin)?;
        }
        drop(input);
        let output = child.wait_with_output()?;
        Ok(ExecOutput { status: output.status.code().unwrap_or(-1), stdout: output.stdout, stderr: output.stderr })
    }

    fn text(path: &Path) -> String {
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn lists_hidden_files_newlines_and_symlinks_sorted() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".aiignore"), "private/").unwrap();
        fs::write(dir.path().join("it's a\nfile.txt"), "text").unwrap();
        fs::write(dir.path().join("..double"), "12345").unwrap();
        fs::create_dir(dir.path().join("Folder")).unwrap();
        symlink(dir.path().join("Folder"), dir.path().join("linked")).unwrap();
        symlink(dir.path().join("nowhere"), dir.path().join("dangling")).unwrap();
        let entries = list(&local, &format!("{}//", text(dir.path()))).unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["Folder", "linked", "..double", ".aiignore", "dangling", "it's a\nfile.txt"]);
        let linked = &entries[1];
        assert!(linked.is_dir && linked.is_symlink);
        assert_eq!(linked.path, format!("{}/linked", text(dir.path())));
        assert_eq!(entries[2].size, 5);
        let dangling = &entries[4];
        assert!(dangling.is_symlink && !dangling.is_dir);
        assert_eq!(dangling.target.as_deref(), Some(text(&dir.path().join("nowhere")).as_str()));
        assert!(list(&local, &text(&dir.path().join("missing"))).unwrap_err().to_string().contains("Directory is not readable."));
    }

    #[test]
    fn parses_padded_sizes_and_rejects_broken_frames() {
        let entries = parse_directory_entries("log\0/srv/log\0f\0     42\0true\0/var/log/app.log\0").unwrap();
        assert_eq!(entries[0].size, 42);
        assert!(parse_directory_entries("").unwrap().is_empty());
        assert!(parse_directory_entries("truncated\0file").is_err());
        assert!(parse_directory_entries("a\0/a\0f\0not-a-size\0false\0\0").is_err());
    }

    #[test]
    fn stats_reads_creates_and_writes_through_the_shell() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        let file = text(&path);
        assert_eq!(stat(&local, &file).unwrap(), None);
        create_file(&local, &file).unwrap();
        assert!(create_file(&local, &file).unwrap_err().to_string().contains("already exists"));
        mutate(&local, &file, TextExpectation::Any, Some("hello\r\n")).unwrap();
        assert_eq!(read(&local, &file, 1024).unwrap(), b"hello\r\n");
        assert_eq!(read(&local, &file, 3).unwrap(), b"hel");
        let found = stat(&local, &file).unwrap().unwrap();
        assert!(!found.is_dir && !found.is_symlink);
        assert_eq!(found.size, 7);
        assert!(found.mtime > 0);
        assert!(stat(&local, &text(dir.path())).unwrap().unwrap().is_dir);
        assert!(mutate(&local, &file, TextExpectation::Content("stale"), Some("x")).unwrap_err().to_string().contains("The file changed"));
        mutate(&local, &file, TextExpectation::Content("hello\r\n"), Some("こんにちは")).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "こんにちは");
        assert!(read(&local, &text(&dir.path().join("missing")), 10).is_err());
        assert!(mutate(&local, "relative.txt", TextExpectation::Any, Some("x")).is_err());
        assert!(!home(&local).unwrap().is_empty());
    }
}
