// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use git2::{Diff, DiffFormat, DiffLine, Oid, Repository};
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tauri::command;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog;
use tauri_plugin_fs;
use tauri_plugin_http;
use tauri_plugin_opener;
use tauri_plugin_os;
use tauri_plugin_shell;
use tauri_plugin_store;

mod lsp;
mod menu;
mod ssh;
mod terminal;
use lsp::{
    list_lsp_servers, lsp_completion, lsp_did_change, lsp_did_close, lsp_did_open, lsp_hover,
    start_lsp_server, stop_lsp_server, LSPState,
};
use ssh::{
    ssh_connect, ssh_disconnect, ssh_execute_command, ssh_list_directory, ssh_read_file,
    ssh_write_file,
};
use terminal::{
    close_terminal_connection, create_terminal_connection, get_available_terminal_types,
    resize_terminal, send_terminal_ctrl_c, send_terminal_ctrl_d, send_terminal_data,
    TerminalManager,
};

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(serde::Serialize)]
struct TableInfo {
    name: String,
}

#[derive(serde::Serialize)]
struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
}

#[derive(serde::Serialize)]
struct GitStatus {
    branch: String,
    ahead: i32,
    behind: i32,
    files: Vec<GitFile>,
}

#[derive(serde::Serialize)]
struct GitFile {
    path: String,
    status: String,
    staged: bool,
}

#[derive(serde::Serialize)]
struct GitCommit {
    hash: String,
    message: String,
    author: String,
    date: String,
}

#[derive(serde::Serialize)]
struct GitDiffLine {
    line_type: String, // "added", "removed", "context", "header"
    content: String,
    old_line_number: Option<u32>,
    new_line_number: Option<u32>,
}

#[derive(serde::Serialize)]
struct GitDiff {
    file_path: String,
    old_path: Option<String>,
    new_path: Option<String>,
    is_new: bool,
    is_deleted: bool,
    is_renamed: bool,
    lines: Vec<GitDiffLine>,
}

fn parse_diff_to_lines(diff: &mut Diff) -> Result<Vec<GitDiffLine>, String> {
    use git2::DiffFormat;

    let mut lines: Vec<GitDiffLine> = Vec::new();

    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        match origin {
            'F' | 'H' => {
                // File or hunk header
                let content = String::from_utf8_lossy(line.content()).to_string();
                lines.push(GitDiffLine {
                    line_type: "header".to_string(),
                    content,
                    old_line_number: None,
                    new_line_number: None,
                });
            }
            '+' => {
                lines.push(GitDiffLine {
                    line_type: "added".to_string(),
                    content: String::from_utf8_lossy(line.content())
                        .trim_end_matches('\n')
                        .to_string(),
                    old_line_number: None,
                    new_line_number: line.new_lineno(),
                });
            }
            '-' => {
                lines.push(GitDiffLine {
                    line_type: "removed".to_string(),
                    content: String::from_utf8_lossy(line.content())
                        .trim_end_matches('\n')
                        .to_string(),
                    old_line_number: line.old_lineno(),
                    new_line_number: None,
                });
            }
            ' ' => {
                lines.push(GitDiffLine {
                    line_type: "context".to_string(),
                    content: String::from_utf8_lossy(line.content())
                        .trim_end_matches('\n')
                        .to_string(),
                    old_line_number: line.old_lineno(),
                    new_line_number: line.new_lineno(),
                });
            }
            _ => {}
        }
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(lines)
}

#[tauri::command]
fn read_directory_custom(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    if !dir_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut entries = Vec::new();

    match fs::read_dir(dir_path) {
        Ok(dir_entries) => {
            for entry in dir_entries {
                match entry {
                    Ok(entry) => {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        let file_path = entry.path().to_string_lossy().to_string();
                        let is_directory = entry.path().is_dir();

                        entries.push(FileEntry {
                            name: file_name,
                            path: file_path,
                            is_dir: is_directory,
                        });
                    }
                    Err(e) => {
                        eprintln!("Error reading entry: {}", e);
                    }
                }
            }
        }
        Err(e) => {
            return Err(format!("Failed to read directory: {}", e));
        }
    }

    // Sort entries: directories first, then files, both alphabetically
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
fn read_file_custom(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    if !file_path.is_file() {
        return Err("Path is not a file".to_string());
    }

    match fs::read_to_string(file_path) {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}

#[tauri::command]
fn write_file_custom(path: String, content: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    match fs::write(file_path, content) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Failed to write file: {}", e)),
    }
}

#[tauri::command]
fn create_directory_custom(path: String) -> Result<(), String> {
    let dir_path = Path::new(&path);

    match fs::create_dir_all(dir_path) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Failed to create directory: {}", e)),
    }
}

#[tauri::command]
fn delete_path_custom(path: String) -> Result<(), String> {
    let target_path = Path::new(&path);

    if !target_path.exists() {
        return Err("Path does not exist".to_string());
    }

    if target_path.is_dir() {
        match fs::remove_dir_all(target_path) {
            Ok(()) => Ok(()),
            Err(e) => Err(format!("Failed to delete directory: {}", e)),
        }
    } else {
        match fs::remove_file(target_path) {
            Ok(()) => Ok(()),
            Err(e) => Err(format!("Failed to delete file: {}", e)),
        }
    }
}

#[tauri::command]
fn get_sqlite_tables(path: String) -> Result<Vec<TableInfo>, String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| e.to_string())?;

    let table_iter = stmt
        .query_map([], |row| Ok(TableInfo { name: row.get(0)? }))
        .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for table in table_iter {
        tables.push(table.map_err(|e| e.to_string())?);
    }

    Ok(tables)
}

#[tauri::command]
fn query_sqlite(path: String, query: String) -> Result<QueryResult, String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    // Get column names
    let column_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();

    // Get rows
    let mut rows = Vec::new();
    let mut row_iter = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = row_iter.next().map_err(|e| e.to_string())? {
        let mut row_data = Vec::new();

        for i in 0..column_names.len() {
            let value = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(i)) => serde_json::Value::Number(i.into()),
                Ok(rusqlite::types::ValueRef::Real(f)) => {
                    // Handle conversion of f64 to serde_json::Value
                    if let Some(n) = serde_json::Number::from_f64(f) {
                        serde_json::Value::Number(n)
                    } else {
                        serde_json::Value::String(f.to_string())
                    }
                }
                Ok(rusqlite::types::ValueRef::Text(t)) => {
                    serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                }
                Ok(rusqlite::types::ValueRef::Blob(b)) => {
                    let hex_string = b
                        .iter()
                        .map(|byte| format!("{:02X}", byte))
                        .collect::<Vec<String>>()
                        .join("");
                    serde_json::Value::String(format!("BLOB({})", hex_string))
                }
                Err(_) => serde_json::Value::Null,
            };

            row_data.push(value);
        }

        rows.push(row_data);
    }

    Ok(QueryResult {
        columns: column_names,
        rows,
    })
}

#[tauri::command]
fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let repo_dir = Path::new(&repo_path);

    // Check if it's a git repository
    if !repo_dir.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    // Get current branch
    let branch_output = Command::new("git")
        .current_dir(repo_dir)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get branch: {}", e))?;

    let branch = if branch_output.status.success() {
        String::from_utf8_lossy(&branch_output.stdout)
            .trim()
            .to_string()
    } else {
        "unknown".to_string()
    };

    // Get ahead/behind counts
    let (ahead, behind) = get_ahead_behind_counts(repo_dir, &branch);

    // Get file status
    let status_output = Command::new("git")
        .current_dir(repo_dir)
        .args(["status", "--porcelain"])
        .output()
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let mut files = Vec::new();
    if status_output.status.success() {
        let status_text = String::from_utf8_lossy(&status_output.stdout);
        for line in status_text.lines() {
            if line.len() >= 3 {
                let staged_char = line.chars().next().unwrap_or(' ');
                let unstaged_char = line.chars().nth(1).unwrap_or(' ');
                let file_path = line[3..].to_string();

                // Determine if file is staged
                let staged = staged_char != ' ' && staged_char != '?';

                // Determine status
                let status = match (staged_char, unstaged_char) {
                    ('M', _) | (_, 'M') => "modified",
                    ('A', _) => "added",
                    ('D', _) | (_, 'D') => "deleted",
                    ('R', _) => "renamed",
                    ('?', '?') => "untracked",
                    _ => "modified",
                }
                .to_string();

                files.push(GitFile {
                    path: file_path,
                    status,
                    staged,
                });
            }
        }
    }

    Ok(GitStatus {
        branch,
        ahead,
        behind,
        files,
    })
}

fn get_ahead_behind_counts(repo_dir: &Path, branch: &str) -> (i32, i32) {
    let output = Command::new("git")
        .current_dir(repo_dir)
        .args([
            "rev-list",
            "--left-right",
            "--count",
            &format!("{}...origin/{}", branch, branch),
        ])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = text.trim().split('\t').collect();
            if parts.len() == 2 {
                let ahead = parts[0].parse().unwrap_or(0);
                let behind = parts[1].parse().unwrap_or(0);
                (ahead, behind)
            } else {
                (0, 0)
            }
        }
        _ => (0, 0),
    }
}

#[tauri::command]
fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["add", &file_path])
        .output()
        .map_err(|e| format!("Failed to add file: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_reset(repo_path: String, file_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["reset", "HEAD", &file_path])
        .output()
        .map_err(|e| format!("Failed to unstage file: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_commit(repo_path: String, message: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["commit", "-m", &message])
        .output()
        .map_err(|e| format!("Failed to commit: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_add_all(repo_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["add", "."])
        .output()
        .map_err(|e| format!("Failed to add all files: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_reset_all(repo_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["reset", "HEAD", "."])
        .output()
        .map_err(|e| format!("Failed to unstage all files: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_log(repo_path: String, limit: Option<u32>) -> Result<Vec<GitCommit>, String> {
    let repo_dir = Path::new(&repo_path);

    // Check if it's a git repository
    if !repo_dir.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let limit_str = limit.unwrap_or(10).to_string();

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args([
            "log",
            &format!("-{}", limit_str),
            "--pretty=format:%H|%s|%an|%ad",
            "--date=short",
        ])
        .output()
        .map_err(|e| format!("Failed to get git log: {}", e))?;

    let mut commits = Vec::new();
    if output.status.success() {
        let log_text = String::from_utf8_lossy(&output.stdout);
        for line in log_text.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() == 4 {
                commits.push(GitCommit {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    date: parts[3].to_string(),
                });
            }
        }
    }

    Ok(commits)
}

#[tauri::command]
fn git_diff_file(repo_path: String, file_path: String, staged: bool) -> Result<GitDiff, String> {
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    // Get the HEAD commit's tree
    let head = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let head_commit = head
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel to commit: {}", e))?;
    let head_tree = head_commit
        .tree()
        .map_err(|e| format!("Failed to get HEAD tree: {}", e))?;

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(&file_path); // Important: only look at the specified file

    let mut diff = if staged {
        // Diff between HEAD and the index (staged changes)
        let index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;
        repo.diff_tree_to_index(Some(&head_tree), Some(&index), Some(&mut diff_opts))
    } else {
        // Diff between HEAD and the working directory (unstaged changes)
        repo.diff_tree_to_workdir(Some(&head_tree), Some(&mut diff_opts))
    }
    .map_err(|e| format!("Failed to create diff: {}", e))?;
    let lines = parse_diff_to_lines(&mut diff)?;

    // We can enhance this to get more accurate new/deleted/renamed status
    // For now, this is a solid starting point.
    let status_entry = repo
        .status_file(Path::new(&file_path))
        .map_err(|e| format!("Could not get file status: {}", e))?;
    let is_new = status_entry.contains(git2::Status::WT_NEW)
        || status_entry.contains(git2::Status::INDEX_NEW);
    let is_deleted = status_entry.contains(git2::Status::WT_DELETED)
        || status_entry.contains(git2::Status::INDEX_DELETED);

    Ok(GitDiff {
        file_path: file_path.clone(),
        old_path: None, // Simplified for now
        new_path: None, // Simplified for now
        is_new,
        is_deleted,
        is_renamed: false, // Simplified for now
        lines,
    })
}

#[tauri::command]
fn git_commit_diff(
    repo_path: String,
    commit_hash: String,
    file_path: Option<String>,
) -> Result<Vec<GitDiff>, String> {
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
    let oid = Oid::from_str(&commit_hash).map_err(|e| format!("Invalid commit hash: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;
    let commit_tree = commit
        .tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;

    // Get the parent commit to diff against
    let parent = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(|e| format!("Failed to get parent commit: {}", e))?,
        )
    } else {
        None
    };

    let parent_tree = if let Some(p) = parent {
        Some(
            p.tree()
                .map_err(|e| format!("Failed to get parent tree: {}", e))?,
        )
    } else {
        None // This is the initial commit, diff against an empty tree
    };

    let mut diff_opts = git2::DiffOptions::new();
    if let Some(path) = &file_path {
        diff_opts.pathspec(path);
    }

    let diff = repo
        .diff_tree_to_tree(
            parent_tree.as_ref(),
            Some(&commit_tree),
            Some(&mut diff_opts),
        )
        .map_err(|e| format!("Failed to create commit diff: {}", e))?;

    let mut results: Vec<GitDiff> = Vec::new();

    for delta in diff.deltas() {
        let file_path = delta
            .new_file()
            .path()
            .unwrap_or_else(|| delta.old_file().path().unwrap())
            .to_string_lossy()
            .into_owned();

        // To get lines for just THIS file, we need a new diff restricted to the file path
        let mut single_file_opts = git2::DiffOptions::new();
        single_file_opts.pathspec(&file_path);

        let mut single_file_diff = repo
            .diff_tree_to_tree(
                parent_tree.as_ref(),
                Some(&commit_tree),
                Some(&mut single_file_opts),
            )
            .map_err(|e| format!("Failed to create single-file diff: {}", e))?;

        results.push(GitDiff {
            file_path: file_path.clone(),
            old_path: delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned()),
            new_path: delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned()),
            is_new: delta.status() == git2::Delta::Added,
            is_deleted: delta.status() == git2::Delta::Deleted,
            is_renamed: delta.status() == git2::Delta::Renamed,
            lines: parse_diff_to_lines(&mut single_file_diff).unwrap_or_default(),
        });
    }

    Ok(results)
}

#[tauri::command]
fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo_dir = Path::new(&repo_path);

    // Check if it's a git repository
    if !repo_dir.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["branch", "--format=%(refname:short)"])
        .output()
        .map_err(|e| format!("Failed to get branches: {}", e))?;

    let mut branches = Vec::new();
    if output.status.success() {
        let branch_text = String::from_utf8_lossy(&output.stdout);
        for line in branch_text.lines() {
            if !line.trim().is_empty() {
                branches.push(line.trim().to_string());
            }
        }
    }

    Ok(branches)
}

#[tauri::command]
fn git_checkout(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["checkout", &branch_name])
        .output()
        .map_err(|e| format!("Failed to checkout branch: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_create_branch(
    repo_path: String,
    branch_name: String,
    from_branch: Option<String>,
) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let mut args = vec!["checkout", "-b", &branch_name];
    if let Some(ref from) = from_branch {
        args.push(from);
    }

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to create branch: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn git_delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["branch", "-d", &branch_name])
        .output()
        .map_err(|e| format!("Failed to delete branch: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// GitHub token storage commands
#[command]
async fn store_github_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("secure.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    store.set("github_token", serde_json::Value::String(token));

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[command]
async fn get_github_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("secure.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    match store.get("github_token") {
        Some(token) => {
            if let Some(token_str) = token.as_str() {
                Ok(Some(token_str.to_string()))
            } else {
                Ok(None)
            }
        }
        None => Ok(None),
    }
}

#[command]
async fn remove_github_token(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("secure.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let _removed = store.delete("github_token");

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[command]
async fn create_remote_window(
    app: tauri::AppHandle,
    connection_id: String,
    connection_name: String,
) -> Result<(), String> {
    let window_label = format!("remote-{}", connection_id);

    let url = format!("index.html?remote={}", connection_id);
    let window = WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App(url.into()))
        .title(format!("Remote: {}", connection_name))
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .center()
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

        // Apply vibrancy effect for macOS on the main thread
        let window_for_vibrancy = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = apply_vibrancy(
                    &window_for_vibrancy,
                    NSVisualEffectMaterial::HudWindow,
                    None,
                    Some(12.0),
                );
            })
            .expect("Failed to run vibrancy on main thread");
    }

    // Send connection info to the new window after a short delay to ensure it's loaded
    let window_clone = window.clone();
    let connection_id_clone = connection_id.clone();
    let connection_name_clone = connection_name.clone();

    // Emit immediately as well
    let _ = window.emit(
        "remote-connection-info",
        serde_json::json!({
            "connectionId": connection_id,
            "connectionName": connection_name,
            "isRemoteWindow": true
        }),
    );

    // Also emit with delay as backup
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let _ = window_clone.emit(
            "remote-connection-info",
            serde_json::json!({
                "connectionId": connection_id_clone,
                "connectionName": connection_name_clone,
                "isRemoteWindow": true
            }),
        );
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let window = app.get_webview_window("main").unwrap();

                // Apply vibrancy effect for macOS
                apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(12.0))
                    .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
            }

            app.on_menu_event(move |_app_handle: &tauri::AppHandle, event| {
                if let Some(window) = _app_handle.get_webview_window("main") {
                    match event.id().0.as_str() {
                        "quit" => {
                            std::process::exit(0);
                        }
                        "new_file" => {
                            let _ = window.emit("menu_new_file", ());
                        }
                        "open_folder" => {
                            let _ = window.emit("menu_open_folder", ());
                        }
                        "save" => {
                            let _ = window.emit("menu_save", ());
                        }
                        "save_as" => {
                            let _ = window.emit("menu_save_as", ());
                        }
                        "close_tab" => {
                            let _ = window.emit("menu_close_tab", ());
                        }
                        "undo" => {
                            let _ = window.emit("menu_undo", ());
                        }
                        "redo" => {
                            let _ = window.emit("menu_redo", ());
                        }
                        "find" => {
                            let _ = window.emit("menu_find", ());
                        }
                        "find_replace" => {
                            let _ = window.emit("menu_find_replace", ());
                        }
                        "command_palette" => {
                            let _ = window.emit("menu_command_palette", ());
                        }
                        "toggle_sidebar" => {
                            let _ = window.emit("menu_toggle_sidebar", ());
                        }
                        "toggle_terminal" => {
                            let _ = window.emit("menu_toggle_terminal", ());
                        }
                        "toggle_ai_chat" => {
                            let _ = window.emit("menu_toggle_ai_chat", ());
                        }
                        "split_editor" => {
                            let _ = window.emit("menu_split_editor", ());
                        }
                        "toggle_vim" => {
                            let _ = window.emit("menu_toggle_vim", ());
                        }
                        "go_to_file" => {
                            let _ = window.emit("menu_go_to_file", ());
                        }
                        "go_to_line" => {
                            let _ = window.emit("menu_go_to_line", ());
                        }
                        "next_tab" => {
                            let _ = window.emit("menu_next_tab", ());
                        }
                        "prev_tab" => {
                            let _ = window.emit("menu_prev_tab", ());
                        }
                        "about" => {
                            let _ = window.emit("menu_about", ());
                        }
                        "help" => {
                            let _ = window.emit("menu_help", ());
                        }
                        // Theme menu items
                        theme_id if theme_id.starts_with("theme_") => {
                            if let Some(theme) = theme_id.strip_prefix("theme_") {
                                let _ = window.emit("menu_theme_change", theme);
                            }
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .manage(LSPState::new())
        .manage(Arc::new(TerminalManager::new()))
        .invoke_handler(tauri::generate_handler![
            read_directory_custom,
            read_file_custom,
            write_file_custom,
            create_directory_custom,
            delete_path_custom,
            get_sqlite_tables,
            query_sqlite,
            git_status,
            git_add,
            git_reset,
            git_commit,
            git_add_all,
            git_reset_all,
            git_log,
            git_diff_file,
            git_commit_diff,
            git_branches,
            git_checkout,
            git_create_branch,
            git_delete_branch,
            store_github_token,
            get_github_token,
            remove_github_token,
            start_lsp_server,
            stop_lsp_server,
            lsp_did_open,
            lsp_did_change,
            lsp_did_close,
            lsp_completion,
            lsp_hover,
            list_lsp_servers,
            create_terminal_connection,
            send_terminal_data,
            resize_terminal,
            close_terminal_connection,
            send_terminal_ctrl_c,
            send_terminal_ctrl_d,
            get_available_terminal_types,
            create_remote_window,
            ssh_connect,
            ssh_disconnect,
            ssh_list_directory,
            ssh_read_file,
            ssh_write_file,
            ssh_execute_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
