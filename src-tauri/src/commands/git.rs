use base64::{Engine as _, engine::general_purpose};
use git2::{Diff, Oid, Repository};
use std::path::Path;
use std::process::Command;
use tauri::command;

#[derive(serde::Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
    pub files: Vec<GitFile>,
}

#[derive(serde::Serialize)]
pub struct GitFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(serde::Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(serde::Serialize)]
pub struct GitDiffLine {
    pub line_type: String,
    pub content: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
}

#[derive(serde::Serialize)]
pub struct GitDiff {
    pub file_path: String,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub is_new: bool,
    pub is_deleted: bool,
    pub is_renamed: bool,
    pub is_binary: bool,
    pub is_image: bool,
    pub old_blob_base64: Option<String>,
    pub new_blob_base64: Option<String>,
    pub lines: Vec<GitDiffLine>,
}

fn is_image_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".bmp")
        || lower.ends_with(".svg")
        || lower.ends_with(".webp")
        || lower.ends_with(".ico")
        || lower.ends_with(".tiff")
        || lower.ends_with(".tif")
        || lower.ends_with(".avif")
        || lower.ends_with(".heic")
        || lower.ends_with(".heif")
        || lower.ends_with(".jfif")
        || lower.ends_with(".pjpeg")
        || lower.ends_with(".pjp")
        || lower.ends_with(".apng")
}

fn get_blob_base64(repo: &Repository, oid: Option<Oid>, _file_path: &str) -> Option<String> {
    if let Some(oid) = oid {
        if !oid.is_zero() {
            if let Ok(blob) = repo.find_blob(oid) {
                let data = blob.content();
                return Some(general_purpose::STANDARD.encode(data));
            }
        }
    }
    None
}

fn parse_diff_to_lines(diff: &mut Diff) -> Result<Vec<GitDiffLine>, String> {
    use git2::DiffFormat;

    let mut lines: Vec<GitDiffLine> = Vec::new();

    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        match origin {
            'F' | 'H' => {
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

fn get_ahead_behind_counts(repo_dir: &Path, branch: &str) -> (i32, i32) {
    let output = Command::new("git")
        .current_dir(repo_dir)
        .args([
            "rev-list",
            "--left-right",
            "--count",
            &format!("{branch}...origin/{branch}"),
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

#[command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let repo_dir = Path::new(&repo_path);

    if !repo_dir.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let branch_output = Command::new("git")
        .current_dir(repo_dir)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get branch: {e}"))?;

    let branch = if branch_output.status.success() {
        String::from_utf8_lossy(&branch_output.stdout)
            .trim()
            .to_string()
    } else {
        "unknown".to_string()
    };

    let (ahead, behind) = get_ahead_behind_counts(repo_dir, &branch);

    let status_output = Command::new("git")
        .current_dir(repo_dir)
        .args(["status", "--porcelain"])
        .output()
        .map_err(|e| format!("Failed to get status: {e}"))?;

    let mut files = Vec::new();
    if status_output.status.success() {
        let status_text = String::from_utf8_lossy(&status_output.stdout);
        for line in status_text.lines() {
            if line.len() >= 3 {
                let staged_char = line.chars().next().unwrap_or(' ');
                let unstaged_char = line.chars().nth(1).unwrap_or(' ');
                let file_path = line[3..].to_string();

                let staged = staged_char != ' ' && staged_char != '?';

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

#[command]
pub fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["add", &file_path])
        .output()
        .map_err(|e| format!("Failed to add file: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_reset(repo_path: String, file_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["reset", "HEAD", &file_path])
        .output()
        .map_err(|e| format!("Failed to unstage file: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_commit(repo_path: String, message: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["commit", "-m", &message])
        .output()
        .map_err(|e| format!("Failed to commit: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_add_all(repo_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["add", "."])
        .output()
        .map_err(|e| format!("Failed to add all files: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_reset_all(repo_path: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["reset", "HEAD", "."])
        .output()
        .map_err(|e| format!("Failed to unstage all files: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_log(repo_path: String, limit: Option<u32>) -> Result<Vec<GitCommit>, String> {
    let repo_dir = Path::new(&repo_path);

    if !repo_dir.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let limit_str = limit.unwrap_or(10).to_string();

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args([
            "log",
            &format!("-{limit_str}"),
            "--pretty=format:%H|%s|%an|%ad",
            "--date=short",
        ])
        .output()
        .map_err(|e| format!("Failed to get git log: {e}"))?;

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

#[command]
pub fn git_diff_file(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<GitDiff, String> {
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let is_image = is_image_file(&file_path);

    let head = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {e}"))?;
    let head_commit = head
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel to commit: {e}"))?;
    let head_tree = head_commit
        .tree()
        .map_err(|e| format!("Failed to get HEAD tree: {e}"))?;

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(&file_path);

    let diff_result = if staged {
        let index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {e}"))?;
        repo.diff_tree_to_index(Some(&head_tree), Some(&index), Some(&mut diff_opts))
    } else {
        repo.diff_tree_to_workdir(Some(&head_tree), Some(&mut diff_opts))
    };

    let mut diff = diff_result.map_err(|e| format!("Failed to create diff: {e}"))?;

    let mut old_blob_base64 = None;
    let mut new_blob_base64 = None;
    let mut lines = Vec::new();

    let deltas: Vec<_> = diff.deltas().collect();

    if deltas.is_empty() {
        let mut broader_diff_opts = git2::DiffOptions::new();
        let broader_diff_result = if staged {
            let index = repo
                .index()
                .map_err(|e| format!("Failed to get index: {e}"))?;
            repo.diff_tree_to_index(Some(&head_tree), Some(&index), Some(&mut broader_diff_opts))
        } else {
            repo.diff_tree_to_workdir(Some(&head_tree), Some(&mut broader_diff_opts))
        };

        if let Ok(broader_diff) = broader_diff_result {
            let all_deltas: Vec<_> = broader_diff.deltas().collect();

            for delta in all_deltas {
                let delta_old_path = delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned());
                let delta_new_path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned());

                if delta_old_path.as_deref() == Some(&file_path)
                    || delta_new_path.as_deref() == Some(&file_path)
                {
                    let is_new = delta.status() == git2::Delta::Added;
                    let is_deleted = delta.status() == git2::Delta::Deleted;
                    let is_renamed = delta.status() == git2::Delta::Renamed;

                    let old_path = delta_old_path;
                    let new_path = delta_new_path;

                    if is_image {
                        let old_oid = delta.old_file().id();
                        let new_oid = delta.new_file().id();

                        if is_deleted {
                            old_blob_base64 = get_blob_base64(
                                &repo,
                                Some(old_oid),
                                old_path.as_deref().unwrap_or(&file_path),
                            );
                        } else if is_renamed {
                            old_blob_base64 = get_blob_base64(
                                &repo,
                                Some(old_oid),
                                old_path.as_deref().unwrap_or(&file_path),
                            );
                            if staged {
                                new_blob_base64 = get_blob_base64(
                                    &repo,
                                    Some(new_oid),
                                    new_path.as_deref().unwrap_or(&file_path),
                                );
                            } else {
                                let abs_path = Path::new(&repo_path)
                                    .join(new_path.as_deref().unwrap_or(&file_path));
                                if let Ok(data) = std::fs::read(abs_path) {
                                    new_blob_base64 = Some(general_purpose::STANDARD.encode(data));
                                }
                            }
                        } else {
                            if !is_new {
                                old_blob_base64 = get_blob_base64(&repo, Some(old_oid), &file_path);
                            }
                            if staged {
                                new_blob_base64 = get_blob_base64(&repo, Some(new_oid), &file_path);
                            } else {
                                let abs_path = Path::new(&repo_path).join(&file_path);
                                if let Ok(data) = std::fs::read(abs_path) {
                                    new_blob_base64 = Some(general_purpose::STANDARD.encode(data));
                                }
                            }
                        }
                        lines = Vec::new();
                    } else {
                        let mut single_file_opts = git2::DiffOptions::new();
                        let target_path = if is_deleted {
                            old_path.as_deref().unwrap_or(&file_path)
                        } else {
                            new_path.as_deref().unwrap_or(&file_path)
                        };
                        single_file_opts.pathspec(target_path);

                        let single_diff_result = if staged {
                            let index = repo
                                .index()
                                .map_err(|e| format!("Failed to get index: {e}"))?;
                            repo.diff_tree_to_index(
                                Some(&head_tree),
                                Some(&index),
                                Some(&mut single_file_opts),
                            )
                        } else {
                            repo.diff_tree_to_workdir(Some(&head_tree), Some(&mut single_file_opts))
                        };

                        if let Ok(mut single_diff) = single_diff_result {
                            lines = parse_diff_to_lines(&mut single_diff).unwrap_or_default();
                        }
                    }

                    return Ok(GitDiff {
                        file_path: file_path.clone(),
                        old_path,
                        new_path,
                        is_new,
                        is_deleted,
                        is_renamed,
                        is_binary: is_image,
                        is_image,
                        old_blob_base64,
                        new_blob_base64,
                        lines,
                    });
                }
            }
        }

        return Err(format!(
            "No changes found for file: {file_path} (searched {file_path} paths)"
        ));
    }

    let delta = &deltas[0];

    let is_new = delta.status() == git2::Delta::Added;
    let is_deleted = delta.status() == git2::Delta::Deleted;
    let is_renamed = delta.status() == git2::Delta::Renamed;

    let old_path = delta
        .old_file()
        .path()
        .map(|p| p.to_string_lossy().into_owned());
    let new_path = delta
        .new_file()
        .path()
        .map(|p| p.to_string_lossy().into_owned());

    if is_image {
        let old_oid = delta.old_file().id();
        let new_oid = delta.new_file().id();

        if is_new {
            if staged {
                new_blob_base64 = get_blob_base64(&repo, Some(new_oid), &file_path);
            } else {
                let abs_path = Path::new(&repo_path).join(&file_path);
                if let Ok(data) = std::fs::read(abs_path) {
                    new_blob_base64 = Some(general_purpose::STANDARD.encode(data));
                }
            }
        } else if is_deleted {
            old_blob_base64 = get_blob_base64(
                &repo,
                Some(old_oid),
                old_path.as_deref().unwrap_or(&file_path),
            );
        } else if is_renamed {
            old_blob_base64 = get_blob_base64(
                &repo,
                Some(old_oid),
                old_path.as_deref().unwrap_or(&file_path),
            );
            if staged {
                new_blob_base64 = get_blob_base64(
                    &repo,
                    Some(new_oid),
                    new_path.as_deref().unwrap_or(&file_path),
                );
            } else {
                let abs_path =
                    Path::new(&repo_path).join(new_path.as_deref().unwrap_or(&file_path));
                if let Ok(data) = std::fs::read(abs_path) {
                    new_blob_base64 = Some(general_purpose::STANDARD.encode(data));
                }
            }
        } else {
            old_blob_base64 = get_blob_base64(&repo, Some(old_oid), &file_path);
            if staged {
                new_blob_base64 = get_blob_base64(&repo, Some(new_oid), &file_path);
            } else {
                let abs_path = Path::new(&repo_path).join(&file_path);
                if let Ok(data) = std::fs::read(abs_path) {
                    new_blob_base64 = Some(general_purpose::STANDARD.encode(data));
                }
            }
        }

        lines = Vec::new();
    } else {
        lines = parse_diff_to_lines(&mut diff)?;
    }

    Ok(GitDiff {
        file_path: file_path.clone(),
        old_path,
        new_path,
        is_new,
        is_deleted,
        is_renamed,
        is_binary: is_image,
        is_image,
        old_blob_base64,
        new_blob_base64,
        lines,
    })
}

#[command]
pub fn git_commit_diff(
    repo_path: String,
    commit_hash: String,
    file_path: Option<String>,
) -> Result<Vec<GitDiff>, String> {
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let oid = Oid::from_str(&commit_hash).map_err(|e| format!("Invalid commit hash: {e}"))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {e}"))?;
    let commit_tree = commit
        .tree()
        .map_err(|e| format!("Failed to get commit tree: {e}"))?;
    let parent = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(|e| format!("Failed to get parent commit: {e}"))?,
        )
    } else {
        None
    };
    let parent_tree = if let Some(p) = &parent {
        Some(
            p.tree()
                .map_err(|e| format!("Failed to get parent tree: {e}"))?,
        )
    } else {
        None
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
        .map_err(|e| format!("Failed to create commit diff: {e}"))?;
    let mut results: Vec<GitDiff> = Vec::new();
    for delta in diff.deltas() {
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let file_path = if delta.status() == git2::Delta::Deleted {
            old_path.clone().unwrap_or_default()
        } else {
            new_path
                .clone()
                .unwrap_or_else(|| old_path.clone().unwrap_or_default())
        };
        let is_image = is_image_file(&file_path);
        let mut is_binary = false;
        let mut old_blob_base64 = None;
        let mut new_blob_base64 = None;
        let is_new = delta.status() == git2::Delta::Added;
        let is_deleted = delta.status() == git2::Delta::Deleted;
        let is_renamed = delta.status() == git2::Delta::Renamed;
        let lines = if is_image {
            is_binary = true;
            let old_oid = delta.old_file().id();
            let new_oid = delta.new_file().id();
            if is_new {
                new_blob_base64 =
                    get_blob_base64(&repo, Some(new_oid), new_path.as_deref().unwrap_or(""));
            } else if is_deleted {
                if let Some(parent_tree) = &parent_tree {
                    let old_blob_oid = old_path
                        .as_ref()
                        .and_then(|p| parent_tree.get_path(Path::new(p)).ok().map(|e| e.id()));
                    old_blob_base64 =
                        get_blob_base64(&repo, old_blob_oid, old_path.as_deref().unwrap_or(""));
                } else {
                    old_blob_base64 =
                        get_blob_base64(&repo, Some(old_oid), old_path.as_deref().unwrap_or(""));
                }
            } else if is_renamed {
                if let Some(parent_tree) = &parent_tree {
                    let old_blob_oid = old_path
                        .as_ref()
                        .and_then(|p| parent_tree.get_path(Path::new(p)).ok().map(|e| e.id()));
                    old_blob_base64 =
                        get_blob_base64(&repo, old_blob_oid, old_path.as_deref().unwrap_or(""));
                } else {
                    old_blob_base64 =
                        get_blob_base64(&repo, Some(old_oid), old_path.as_deref().unwrap_or(""));
                }
                new_blob_base64 =
                    get_blob_base64(&repo, Some(new_oid), new_path.as_deref().unwrap_or(""));
            } else {
                if let Some(parent_tree) = &parent_tree {
                    let old_blob_oid = old_path
                        .as_ref()
                        .and_then(|p| parent_tree.get_path(Path::new(p)).ok().map(|e| e.id()));
                    old_blob_base64 =
                        get_blob_base64(&repo, old_blob_oid, old_path.as_deref().unwrap_or(""));
                } else {
                    old_blob_base64 =
                        get_blob_base64(&repo, Some(old_oid), old_path.as_deref().unwrap_or(""));
                }
                new_blob_base64 =
                    get_blob_base64(&repo, Some(new_oid), new_path.as_deref().unwrap_or(""));
            }
            Vec::new()
        } else {
            let mut single_file_opts = git2::DiffOptions::new();
            single_file_opts.pathspec(&file_path);
            let mut single_file_diff = repo
                .diff_tree_to_tree(
                    parent_tree.as_ref(),
                    Some(&commit_tree),
                    Some(&mut single_file_opts),
                )
                .map_err(|e| format!("Failed to create single-file diff: {e}"))?;
            parse_diff_to_lines(&mut single_file_diff).unwrap_or_default()
        };
        results.push(GitDiff {
            file_path: file_path.clone(),
            old_path: old_path.clone(),
            new_path: new_path.clone(),
            is_new,
            is_deleted,
            is_renamed,
            is_binary,
            is_image,
            old_blob_base64,
            new_blob_base64,
            lines,
        });
    }
    Ok(results)
}

#[command]
pub fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo_dir = Path::new(&repo_path);

    if !repo_dir.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["branch", "--format=%(refname:short)"])
        .output()
        .map_err(|e| format!("Failed to get branches: {e}"))?;

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

#[command]
pub fn git_checkout(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["checkout", &branch_name])
        .output()
        .map_err(|e| format!("Failed to checkout branch: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_create_branch(
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
        .map_err(|e| format!("Failed to create branch: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub fn git_delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo_dir = Path::new(&repo_path);

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args(["branch", "-d", &branch_name])
        .output()
        .map_err(|e| format!("Failed to delete branch: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
