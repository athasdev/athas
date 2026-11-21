//! The protocol's methods (`www/cloud/src/workspace-api.ts`). Paths are relative to the
//! workspace root. Beyond the cloud's set, `fs.createFile` and `fs.copy` cover what the
//! workbench's file tree does, `lsp.*` runs language servers for the editor and `agent.*` runs ACP
//! agents for agent sessions.

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use serde_json::{Map, Value, json};
use web_protocol::{
    CallError, MAX_FILE_BYTES, MAX_LISTED_FILES, from_base64,
    git::{self, BRANCH_FORMAT, LOG_FORMAT, STASH_FORMAT, is_branch_name},
    resolve_path, to_base64,
};

use crate::{Workspace, agents, relays::RelayOptions, search, terminals::TerminalOptions};

type Params = Map<String, Value>;

/// Where files cross between the browser and the server: uploads from a file input, and files
/// on their way to a download. Each transfer gets a folder of its own.
fn transfers_root() -> PathBuf {
    std::env::temp_dir().join("athas-transfers")
}

fn new_transfer_dir() -> Result<PathBuf, CallError> {
    let dir = transfers_root().join(crate::random_key());
    std::fs::create_dir_all(&dir).map_err(|error| CallError::new("io", format!("Could not make a transfer folder: {error}")))?;
    Ok(dir)
}

/// A file inside a transfer folder, and nothing else.
fn transfer_file(path: &str) -> Result<PathBuf, CallError> {
    let outside = || CallError::invalid(format!("{path} is not a transferred file."));
    let root = transfers_root().canonicalize().map_err(|_| outside())?;
    let file = Path::new(path).canonicalize().map_err(|_| outside())?;
    if !file.starts_with(&root) || file == root || !file.is_file() {
        return Err(outside());
    }
    Ok(file)
}

fn file_name_of(name: &str) -> Result<String, CallError> {
    let name = Path::new(name.trim()).file_name().and_then(|name| name.to_str()).map(str::to_string).filter(|name| !name.is_empty() && name != "..");
    name.ok_or_else(|| CallError::invalid("The file has no name."))
}

fn string<'a>(params: &'a Params, name: &str) -> Result<&'a str, CallError> {
    params.get(name).and_then(Value::as_str).ok_or_else(|| CallError::invalid(format!("Invalid {name}.")))
}

fn number(params: &Params, name: &str, min: u64, max: u64) -> Result<Option<u64>, CallError> {
    match params.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_u64().filter(|value| (min..=max).contains(value)).map(Some).ok_or_else(|| CallError::invalid(format!("Invalid {name}."))),
    }
}

fn flag(params: &Params, name: &str) -> bool {
    params.get(name).and_then(Value::as_bool).unwrap_or(false)
}

fn args(params: &Params) -> Vec<String> {
    params
        .get("args")
        .and_then(Value::as_array)
        .map(|args| args.iter().map(|arg| arg.as_str().map(str::to_string).unwrap_or_else(|| arg.to_string())).collect())
        .unwrap_or_default()
}

fn env(params: &Params) -> Result<Vec<(String, String)>, CallError> {
    match params.get("env") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Object(env)) => env
            .iter()
            .map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_string())).ok_or_else(|| CallError::invalid("Invalid env.")))
            .collect(),
        Some(_) => Err(CallError::invalid("Invalid env.")),
    }
}

fn cwd(root: &Path, params: &Params) -> Result<PathBuf, CallError> {
    match params.get("cwd").and_then(Value::as_str).filter(|cwd| !cwd.is_empty()) {
        Some(cwd) => resolve_path(root, cwd),
        None => Ok(root.to_path_buf()),
    }
}

fn path(workspace: &Workspace, params: &Params, name: &str) -> Result<PathBuf, CallError> {
    resolve_path(&workspace.root, string(params, name)?)
}

fn paths(workspace: &Workspace, params: &Params) -> Result<Vec<String>, CallError> {
    let paths: Vec<String> = params
        .get("paths")
        .and_then(Value::as_array)
        .filter(|paths| !paths.is_empty() && paths.len() <= 1000)
        .ok_or_else(|| CallError::invalid("Invalid paths."))?
        .iter()
        .map(|path| path.as_str().map(str::to_string).ok_or_else(|| CallError::invalid("Invalid paths.")))
        .collect::<Result<_, _>>()?;
    for path in &paths {
        resolve_path(&workspace.root, path)?;
    }
    Ok(paths)
}

fn fs_error(path: &str) -> impl Fn(anyhow::Error) -> CallError + '_ {
    move |error| {
        let missing = error.chain().any(|cause| cause.downcast_ref::<std::io::Error>().is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound));
        if missing { CallError::new("not_found", format!("{path} does not exist.")) } else { CallError::new("fs_error", format!("{error:#}")) }
    }
}

fn io_error(path: &str) -> impl Fn(std::io::Error) -> CallError + '_ {
    move |error| fs_error(path)(error.into())
}

fn git_output(root: &Path, args: &[&str]) -> Result<std::process::Output, CallError> {
    Command::new("git").args(args).current_dir(root).output().map_err(|error| CallError::new("git_failed", format!("Could not run git: {error}")))
}

fn git_run(root: &Path, args: &[&str]) -> Result<String, CallError> {
    let output = git_output(root, args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        let message = if message.is_empty() { format!("git {} failed.", args.first().unwrap_or(&"")) } else { message.chars().take(2000).collect() };
        return Err(CallError::new("git_failed", message));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `git` with `input` on its stdin.
fn git_input(root: &Path, args: &[&str], input: &str) -> Result<String, CallError> {
    use std::io::Write as _;
    let failed = |error: std::io::Error| CallError::new("git_failed", format!("Could not run git: {error}"));
    let mut child = Command::new("git")
        .args(args)
        .current_dir(root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(failed)?;
    let mut stdin = child.stdin.take().ok_or_else(|| CallError::new("git_failed", "git has no stdin."))?;
    let input = input.to_string();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let output = child.wait_with_output().map_err(failed)?;
    let _ = writer.join();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CallError::new("git_failed", stderr.trim().chars().take(2000).collect::<String>()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn rev(value: &str) -> Result<&str, CallError> {
    if value.is_empty() || value.starts_with('-') || !value.chars().all(|c| c.is_ascii_alphanumeric() || "._/@{}~^-".contains(c)) {
        return Err(CallError::invalid("Invalid rev."));
    }
    Ok(value)
}

/// `git show --format=%an…` dates (`--date=raw`): seconds and `+hhmm`.
fn person(name: &str, email: &str, date: &str) -> Value {
    let (time, offset) = date.split_once(' ').unwrap_or((date, "+0000"));
    let sign = if offset.starts_with('-') { -1 } else { 1 };
    let digits = offset.trim_start_matches(['+', '-']);
    let minutes = digits.get(..2).and_then(|hours| hours.parse::<i32>().ok()).unwrap_or(0) * 60 + digits.get(2..4).and_then(|minutes| minutes.parse::<i32>().ok()).unwrap_or(0);
    json!({ "name": name, "email": email, "time": time.parse::<i64>().unwrap_or(0), "offsetMinutes": sign * minutes })
}

/// The files a commit changes: `--name-status -z` and `--numstat -z` read together.
fn commit_files(root: &Path, rev: &str) -> Result<Vec<Value>, CallError> {
    let statuses = git_run(root, &["show", "--format=", "--name-status", "-M", "-z", rev])?;
    let mut fields = statuses.split('\0').filter(|field| !field.is_empty());
    let mut files = Vec::new();
    while let Some(code) = fields.next() {
        let (status, old_path, path) = match code.chars().next() {
            Some('R' | 'C') => ("renamed", fields.next(), fields.next()),
            Some('A') => ("added", None, fields.next()),
            Some('D') => ("deleted", None, fields.next()),
            _ => ("modified", None, fields.next()),
        };
        files.push((status, old_path.map(str::to_string), path.unwrap_or_default().to_string()));
    }
    let numstat = git_run(root, &["show", "--format=", "--numstat", "-M", "-z", rev])?;
    let mut counts = std::collections::HashMap::new();
    let mut fields = numstat.split('\0');
    while let Some(field) = fields.next() {
        let mut parts = field.splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let path = if path.is_empty() {
            fields.next();
            fields.next().unwrap_or_default()
        } else {
            path
        };
        counts.insert(path.to_string(), (added.parse::<u64>().ok(), deleted.parse::<u64>().ok()));
    }
    Ok(files
        .into_iter()
        .map(|(status, old_path, path)| {
            let (added, deleted) = counts.get(&path).copied().unwrap_or((Some(0), Some(0)));
            json!({ "path": path, "oldPath": old_path, "status": status, "additions": added.unwrap_or(0), "deletions": deleted.unwrap_or(0), "binary": added.is_none() })
        })
        .collect())
}

fn read_bytes(workspace: &Workspace, relative: &str) -> Result<Vec<u8>, CallError> {
    let absolute = resolve_path(&workspace.root, relative)?;
    let metadata = std::fs::metadata(&absolute).map_err(io_error(relative))?;
    if metadata.is_dir() {
        return Err(CallError::invalid(format!("{relative} is a directory.")));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(CallError::new("too_large", format!("{relative} is too large to open.")));
    }
    std::fs::read(&absolute).map_err(io_error(relative))
}

fn kind_of(file_type: std::fs::FileType) -> &'static str {
    if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_dir() {
        "directory"
    } else {
        "file"
    }
}

pub(crate) fn call(workspace: &Workspace, method: &str, params: &Params) -> Result<Value, CallError> {
    let root = workspace.root.as_path();
    match method {
        "fs.read" => {
            let bytes = read_bytes(workspace, string(params, "path")?)?;
            Ok(json!({ "content": to_base64(&bytes), "size": bytes.len() }))
        }
        "fs.write" => {
            let relative = string(params, "path")?;
            let absolute = resolve_path(root, relative)?;
            let content = from_base64(params.get("content").unwrap_or(&Value::Null))?;
            if content.len() as u64 > MAX_FILE_BYTES {
                return Err(CallError::new("too_large", format!("{relative} is too large to save.")));
            }
            if let Some(expected) = number(params, "expectedSize", 0, u64::MAX)?
                && let Ok(current) = std::fs::metadata(&absolute)
                && current.len() != expected
            {
                return Err(CallError::new("conflict", format!("{relative} changed in the workspace.")));
            }
            if let Some(parent) = absolute.parent() {
                std::fs::create_dir_all(parent).map_err(io_error(relative))?;
            }
            std::fs::write(&absolute, &content).map_err(io_error(relative))?;
            Ok(json!({ "size": content.len() }))
        }
        "fs.stat" => {
            let relative = string(params, "path")?;
            let metadata = std::fs::symlink_metadata(resolve_path(root, relative)?).map_err(io_error(relative))?;
            let mtime = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64).unwrap_or(0);
            #[cfg(unix)]
            let mode = std::os::unix::fs::PermissionsExt::mode(&metadata.permissions());
            #[cfg(not(unix))]
            let mode = 0;
            Ok(json!({ "type": kind_of(metadata.file_type()), "size": metadata.len(), "mode": mode, "mtime": mtime }))
        }
        "fs.exists" => Ok(json!({ "exists": workspace.fs.exists(&path(workspace, params, "path")?) })),
        "fs.readdir" => {
            let relative = string(params, "path")?;
            let absolute = resolve_path(root, relative)?;
            let entries = workspace.fs.read_dir(&absolute).map_err(fs_error(relative))?;
            let entries: Vec<Value> = entries
                .into_iter()
                .filter(|entry| !(absolute == root && entry.name == ".git"))
                .map(|entry| {
                    let kind = if entry.is_symlink { "symlink" } else if entry.is_dir { "directory" } else { "file" };
                    json!({ "name": entry.name, "type": kind })
                })
                .collect();
            Ok(json!({ "entries": entries }))
        }
        "fs.mkdir" => {
            let relative = string(params, "path")?;
            let absolute = resolve_path(root, relative)?;
            if params.get("recursive").and_then(Value::as_bool) == Some(false) {
                std::fs::create_dir(&absolute).map_err(io_error(relative))?;
            } else {
                std::fs::create_dir_all(&absolute).map_err(io_error(relative))?;
            }
            Ok(json!({}))
        }
        "fs.createFile" => {
            let relative = string(params, "path")?;
            workspace.fs.create_file(&resolve_path(root, relative)?).map_err(fs_error(relative))?;
            Ok(json!({}))
        }
        "fs.remove" => {
            let relative = string(params, "path")?;
            let absolute = resolve_path(root, relative)?;
            if absolute == root {
                return Err(CallError::invalid("The workspace root cannot be removed."));
            }
            if let Some(expected) = params.get("expectedContent").filter(|value| !value.is_null()) {
                if read_bytes(workspace, relative)? != from_base64(expected)? {
                    return Err(CallError::new("conflict", format!("{relative} changed in the workspace.")));
                }
            }
            if absolute.is_dir() && !flag(params, "recursive") && std::fs::read_dir(&absolute).map_err(io_error(relative))?.next().is_some() {
                return Err(CallError::new("fs_error", format!("{relative} is not empty.")));
            }
            workspace.fs.remove(&absolute).map_err(fs_error(relative))?;
            Ok(json!({}))
        }
        "fs.rename" => {
            let from = string(params, "from")?;
            let source = resolve_path(root, from)?;
            let target = path(workspace, params, "to")?;
            if source == root || target == root {
                return Err(CallError::invalid("The workspace root cannot be moved."));
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(io_error(from))?;
            }
            workspace.fs.move_path(&source, &target).map_err(fs_error(from))?;
            Ok(json!({}))
        }
        "fs.copy" => {
            let from = string(params, "from")?;
            let source = resolve_path(root, from)?;
            workspace.fs.copy(&source, &path(workspace, params, "to")?).map_err(fs_error(from))?;
            Ok(json!({}))
        }
        "transfer.upload" => {
            let name = file_name_of(string(params, "name")?)?;
            let content = from_base64(params.get("content").unwrap_or(&Value::Null))?;
            if content.len() as u64 > MAX_FILE_BYTES {
                return Err(CallError::new("too_large", format!("{name} is too large to upload.")));
            }
            let path = new_transfer_dir()?.join(&name);
            std::fs::write(&path, &content).map_err(io_error(&name))?;
            Ok(json!({ "path": path.to_string_lossy() }))
        }
        "transfer.dir" => Ok(json!({ "path": new_transfer_dir()?.to_string_lossy() })),
        "transfer.read" => {
            let path = transfer_file(string(params, "path")?)?;
            if std::fs::metadata(&path).map_err(io_error(&path.to_string_lossy()))?.len() > MAX_FILE_BYTES {
                return Err(CallError::new("too_large", "The file is too large to download."));
            }
            let bytes = std::fs::read(&path).map_err(io_error(&path.to_string_lossy()))?;
            let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            Ok(json!({ "name": name, "content": to_base64(&bytes) }))
        }
        "fs.list" => {
            let files = match git_run(root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"]) {
                Ok(output) => {
                    let mut files: Vec<String> = output.split('\0').filter(|file| !file.is_empty()).map(str::to_string).collect();
                    files.dedup();
                    files
                }
                Err(_) => search::walk_files(root),
            };
            let truncated = files.len() > MAX_LISTED_FILES;
            Ok(json!({ "files": files.into_iter().take(MAX_LISTED_FILES).collect::<Vec<_>>(), "truncated": truncated }))
        }
        "search.content" => search::content(root, params),
        "terminal.create" => {
            let cols = number(params, "cols", 1, 1000)?.ok_or_else(|| CallError::invalid("Invalid terminal size."))? as u16;
            let rows = number(params, "rows", 1, 500)?.ok_or_else(|| CallError::invalid("Invalid terminal size."))? as u16;
            let cwd = match params.get("cwd").and_then(Value::as_str).filter(|cwd| !cwd.is_empty()) {
                Some(cwd) => resolve_path(root, cwd)?,
                None => root.to_path_buf(),
            };
            let env = env(params)?;
            let command = match params.get("command").and_then(Value::as_str).filter(|command| !command.is_empty()) {
                Some(command) => Some((command.to_string(), args(params))),
                None => None,
            };
            let id = workspace.terminals.create(TerminalOptions { cols, rows, cwd, env, command })?;
            Ok(json!({ "id": id }))
        }
        "terminal.write" => {
            let id = string(params, "id")?;
            let data = match (params.get("data").and_then(Value::as_str), params.get("bytes")) {
                (Some(data), _) => data.as_bytes().to_vec(),
                (None, Some(bytes)) => from_base64(bytes)?,
                (None, None) => return Err(CallError::invalid("Send data or bytes.")),
            };
            workspace.terminals.write(id, &data)?;
            Ok(json!({}))
        }
        "terminal.resize" => {
            let cols = number(params, "cols", 1, 1000)?.ok_or_else(|| CallError::invalid("Invalid terminal size."))? as u16;
            let rows = number(params, "rows", 1, 500)?.ok_or_else(|| CallError::invalid("Invalid terminal size."))? as u16;
            workspace.terminals.resize(string(params, "id")?, cols, rows)?;
            Ok(json!({}))
        }
        "terminal.pause" => {
            workspace.terminals.set_paused(string(params, "id")?, flag(params, "paused"))?;
            Ok(json!({}))
        }
        "terminal.close" => {
            workspace.terminals.close(string(params, "id")?)?;
            Ok(json!({}))
        }
        "terminal.list" => Ok(json!({ "terminals": workspace.terminals.list() })),
        "lsp.start" => {
            let command = string(params, "command")?.into();
            let id = workspace.language_servers.start(RelayOptions { command, args: args(params), env: env(params)?, cwd: cwd(root, params)?, path: None })?;
            Ok(json!({ "id": id }))
        }
        "lsp.send" => {
            workspace.language_servers.send(string(params, "id")?, string(params, "message")?)?;
            Ok(json!({}))
        }
        "lsp.stop" => {
            workspace.language_servers.stop(string(params, "id")?)?;
            Ok(json!({}))
        }
        "agent.start" => {
            let (command, agent_args, path) = agents::resolve(string(params, "agent")?, string(params, "command")?, args(params))?;
            let id = workspace.agents.start(RelayOptions { command, args: agent_args, env: env(params)?, cwd: cwd(root, params)?, path })?;
            Ok(json!({ "id": id }))
        }
        "agent.send" => {
            workspace.agents.send(string(params, "id")?, string(params, "message")?)?;
            Ok(json!({}))
        }
        "agent.stop" => {
            workspace.agents.stop(string(params, "id")?)?;
            Ok(json!({}))
        }
        method if method.starts_with(web_protocol::github::METHOD_PREFIX) => crate::github::call(workspace, method, params),
        "preview.base" => Ok(json!({ "path": format!("{}{}/", crate::serve::PREVIEW_PREFIX, workspace.preview_key) })),
        method if method.starts_with(docker_view::relay::METHOD_PREFIX) => crate::services::docker(workspace, method, params),
        "git.status" => Ok(serde_json::to_value(git::parse_status(&git_run(root, &["status", "--porcelain=v2", "--branch", "-z"])?)).unwrap_or_default()),
        "git.diff" => {
            let staged = flag(params, "staged");
            let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
            if staged {
                args.push("--cached");
            }
            let Some(relative) = params.get("path").and_then(Value::as_str) else { return Ok(json!({ "patch": git_run(root, &args)? })) };
            resolve_path(root, relative)?;
            args.extend(["--", relative]);
            let patch = git_run(root, &args)?;
            if !patch.is_empty() || staged {
                return Ok(json!({ "patch": patch }));
            }
            // An untracked file has no diff against the index; show it as added.
            let untracked = git_run(root, &["ls-files", "--others", "--exclude-standard", "--", relative])?;
            if untracked.trim().is_empty() {
                return Ok(json!({ "patch": patch }));
            }
            let output = git_output(root, &["diff", "--no-color", "--no-index", "--", "/dev/null", relative])?;
            Ok(json!({ "patch": String::from_utf8_lossy(&output.stdout) }))
        }
        "git.show" => {
            let relative = string(params, "path")?;
            resolve_path(root, relative)?;
            let rev = rev(params.get("rev").and_then(Value::as_str).unwrap_or("HEAD"))?;
            let output = git_output(root, &["show", &format!("{rev}:{relative}")])?;
            if !output.status.success() {
                return Err(CallError::new("not_found", format!("{relative} is not in {rev}.")));
            }
            Ok(json!({ "content": to_base64(&output.stdout) }))
        }
        "git.patch" => {
            let target = string(params, "target")?;
            let (kind, rest) = target.split_once(':').ok_or_else(|| CallError::invalid("Invalid target."))?;
            let checked = |path: &str| resolve_path(root, path).map(|_| path.to_string());
            let patch = match kind {
                "w" => {
                    let mut params = Params::new();
                    params.insert("path".into(), Value::String(checked(rest)?));
                    return call(workspace, "git.diff", &params);
                }
                "s" => git_run(root, &["diff", "--no-color", "--no-ext-diff", "-M", "--cached", "--", &checked(rest)?])?,
                "c" => match rest.split_once(':') {
                    Some((commit, path)) => git_run(root, &["show", "--format=", "--no-color", "--no-ext-diff", "-M", rev(commit)?, "--", &checked(path)?])?,
                    None => git_run(root, &["show", "--format=", "--no-color", "--no-ext-diff", "-M", rev(rest)?])?,
                },
                "t" => {
                    let index: usize = rest.parse().map_err(|_| CallError::invalid("Invalid stash."))?;
                    git_run(root, &["stash", "show", "-p", "--no-color", "--no-ext-diff", "-M", "--include-untracked", &format!("stash@{{{index}}}")])?
                }
                "r" => {
                    let (base, target) = rest.split_once("..").ok_or_else(|| CallError::invalid("Invalid target."))?;
                    git_run(root, &["diff", "--no-color", "--no-ext-diff", "-M", rev(base)?, rev(target)?])?
                }
                _ => return Err(CallError::invalid("Invalid target.")),
            };
            Ok(json!({ "patch": patch }))
        }
        "git.commitInfo" => {
            let rev = rev(string(params, "rev")?)?;
            let header = git_run(root, &["show", "-s", "--date=raw", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%B", rev])?;
            let fields: Vec<&str> = header.splitn(9, '\x1f').collect();
            let [hash, parents, author, author_email, author_date, committer, committer_email, committer_date, message] = fields[..] else {
                return Err(CallError::new("git_failed", "Unexpected git show output."));
            };
            Ok(json!({
                "hash": hash,
                "parents": parents.split_whitespace().collect::<Vec<_>>(),
                "author": person(author, author_email, author_date),
                "committer": person(committer, committer_email, committer_date),
                "message": message.trim(),
                "files": commit_files(root, rev)?,
            }))
        }
        "git.blame" => {
            let relative = string(params, "path")?;
            resolve_path(root, relative)?;
            let porcelain = match params.get("content").and_then(Value::as_str) {
                Some(content) => git_input(root, &["blame", "--porcelain", "--contents", "-", "--", relative], content)?,
                None => git_run(root, &["blame", "--porcelain", "--", relative])?,
            };
            Ok(json!({ "porcelain": porcelain }))
        }
        "git.apply" => {
            let patch = string(params, "patch")?;
            let mut args = vec!["apply"];
            if flag(params, "cached") {
                args.push("--cached");
            }
            if flag(params, "reverse") {
                args.push("--reverse");
            }
            args.push("-");
            git_input(root, &args, patch)?;
            Ok(json!({}))
        }
        "git.add" => {
            if flag(params, "all") {
                git_run(root, &["add", "--all"])?;
            } else {
                let paths = paths(workspace, params)?;
                git_run(root, &[&["add", "--"][..], &paths.iter().map(String::as_str).collect::<Vec<_>>()].concat())?;
            }
            Ok(json!({}))
        }
        "git.reset" => {
            if flag(params, "all") {
                git_run(root, &["reset", "-q"])?;
            } else {
                let paths = paths(workspace, params)?;
                git_run(root, &[&["reset", "-q", "--"][..], &paths.iter().map(String::as_str).collect::<Vec<_>>()].concat())?;
            }
            Ok(json!({}))
        }
        // Drops working tree changes; untracked files are deleted.
        "git.discard" => {
            if flag(params, "all") {
                git_run(root, &["checkout", "--", "."])?;
                git_run(root, &["clean", "-fd"])?;
                return Ok(json!({}));
            }
            let paths = paths(workspace, params)?;
            let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
            let untracked_output = git_run(root, &[&["ls-files", "-z", "--others", "--exclude-standard", "--"][..], &refs].concat())?;
            let untracked: Vec<&str> = untracked_output.split('\0').filter(|path| !path.is_empty()).collect();
            let tracked: Vec<&str> = refs.iter().copied().filter(|path| !untracked.contains(path)).collect();
            if !tracked.is_empty() {
                git_run(root, &[&["checkout", "--"][..], &tracked].concat())?;
            }
            if !untracked.is_empty() {
                git_run(root, &[&["clean", "-f", "--"][..], &untracked].concat())?;
            }
            Ok(json!({}))
        }
        "git.commit" => {
            let message = string(params, "message")?;
            if message.trim().is_empty() {
                return Err(CallError::invalid("Write a commit message."));
            }
            let mut args = vec!["commit"];
            if flag(params, "amend") {
                args.push("--amend");
            }
            if flag(params, "signOff") {
                args.push("--signoff");
            }
            args.extend(["-m", message]);
            git_run(root, &args)?;
            Ok(json!({ "hash": git_run(root, &["rev-parse", "HEAD"])?.trim() }))
        }
        "git.log" => {
            let limit = number(params, "limit", 1, 1000)?.unwrap_or(50);
            let skip = number(params, "skip", 0, 1_000_000)?.unwrap_or(0);
            let format = format!("--format={LOG_FORMAT}");
            let (limit, skip) = (format!("-n{limit}"), format!("--skip={skip}"));
            let mut args = vec!["log", format.as_str(), limit.as_str(), skip.as_str()];
            if let Some(relative) = params.get("path").and_then(Value::as_str).filter(|path| !path.is_empty()) {
                resolve_path(root, relative)?;
                args.extend(["--", relative]);
            }
            // A branch without commits has no log.
            let commits = git_run(root, &args).map(|output| git::parse_log(&output)).unwrap_or_default();
            Ok(json!({ "commits": commits }))
        }
        "git.branches" => {
            let format = format!("--format={BRANCH_FORMAT}");
            Ok(serde_json::to_value(git::parse_branches(&git_run(root, &["for-each-ref", &format, "refs/heads", "refs/remotes"])?)).unwrap_or_default())
        }
        "git.checkout" => {
            let branch = string(params, "branch")?;
            if !is_branch_name(branch) {
                return Err(CallError::invalid("Invalid branch name."));
            }
            if flag(params, "create") {
                match params.get("from").and_then(Value::as_str).filter(|from| !from.is_empty()) {
                    Some(from) if from.starts_with('-') => return Err(CallError::invalid("Invalid start point.")),
                    Some(from) => git_run(root, &["checkout", "-b", branch, from])?,
                    None => git_run(root, &["checkout", "-b", branch])?,
                };
            } else {
                git_run(root, &["checkout", branch])?;
            }
            Ok(json!({ "branch": branch }))
        }
        "git.deleteBranch" => {
            let branch = string(params, "branch")?;
            if !is_branch_name(branch) {
                return Err(CallError::invalid("Invalid branch name."));
            }
            git_run(root, &["branch", if flag(params, "force") { "-D" } else { "-d" }, branch])?;
            Ok(json!({}))
        }
        "git.diffStats" => {
            let mut stats = git::parse_numstat(&git_run(root, &["diff", "--numstat", "-z", "--no-color"])?, false);
            // A repository without commits has nothing staged against HEAD yet.
            stats.extend(git_run(root, &["diff", "--cached", "--numstat", "-z", "--no-color"]).map(|output| git::parse_numstat(&output, true)).unwrap_or_default());
            Ok(json!({ "stats": stats }))
        }
        "git.stashes" => {
            let format = format!("--format={STASH_FORMAT}");
            Ok(json!({ "stashes": git::parse_stashes(&git_run(root, &["stash", "list", &format])?) }))
        }
        "git.stash" => {
            let mut args = vec!["stash", "push", "--include-untracked"];
            if let Some(message) = params.get("message").and_then(Value::as_str).filter(|message| !message.trim().is_empty()) {
                args.extend(["-m", message]);
            }
            let paths = match params.get("paths") {
                None | Some(Value::Null) => Vec::new(),
                Some(_) => paths(workspace, params)?,
            };
            if !paths.is_empty() {
                args.push("--");
                args.extend(paths.iter().map(String::as_str));
            }
            git_run(root, &args)?;
            Ok(json!({}))
        }
        "git.stashAction" => {
            let index = number(params, "index", 0, 10_000)?.ok_or_else(|| CallError::invalid("Invalid index."))?;
            let action = match string(params, "action")? {
                action @ ("apply" | "pop" | "drop") => action,
                _ => return Err(CallError::invalid("Invalid action.")),
            };
            git_run(root, &["stash", action, &format!("stash@{{{index}}}")])?;
            Ok(json!({}))
        }
        "git.fetch" => {
            git_run(root, &["fetch", "--prune", "origin"])?;
            Ok(json!({}))
        }
        "git.pull" => {
            git_run(root, &["pull", if flag(params, "rebase") { "--rebase" } else { "--ff-only" }])?;
            Ok(json!({}))
        }
        "git.push" => {
            let branch = git_run(root, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
            if branch == "HEAD" {
                return Err(CallError::invalid("Check out a branch before pushing."));
            }
            git_run(root, &["push", "--set-upstream", "origin", &format!("HEAD:refs/heads/{branch}")])?;
            Ok(json!({ "branch": branch }))
        }
        _ => Err(CallError::new("unknown_method", format!("Unknown method {method}."))),
    }
}
