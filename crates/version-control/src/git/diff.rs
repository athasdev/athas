use crate::git::{DiffLineType, GitDiff, GitDiffLine, GitDiffStat, get_blob_base64, is_image_file};
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use git2::{Diff, DiffFormat, Oid, Repository, Tree};
use std::{collections::HashMap, path::Path};

const LARGE_DIFF_LINE_THRESHOLD: usize = 20_000;

#[derive(Default)]
struct ParsedDiffFile {
   lines: Vec<GitDiffLine>,
   raw_patch: Option<String>,
   additions: usize,
   deletions: usize,
   line_count: usize,
}

impl ParsedDiffFile {
   fn push_raw_line(&mut self, origin: char, content: &[u8]) {
      let raw_patch = self.raw_patch.get_or_insert_with(String::new);
      match origin {
         '+' | '-' | ' ' => raw_patch.push(origin),
         _ => {}
      }
      raw_patch.push_str(&String::from_utf8_lossy(content));
   }

   fn push_line(&mut self, origin: char, line: GitDiffLine, content: &[u8]) {
      self.line_count += 1;
      if matches!(origin, '+') {
         self.additions += 1;
      } else if matches!(origin, '-') {
         self.deletions += 1;
      }

      if self.raw_patch.is_some() {
         self.push_raw_line(origin, content);
         return;
      }

      if self.line_count > LARGE_DIFF_LINE_THRESHOLD {
         let mut raw_patch = String::new();
         for existing_line in &self.lines {
            match &existing_line.line_type {
               DiffLineType::Added => raw_patch.push('+'),
               DiffLineType::Removed => raw_patch.push('-'),
               DiffLineType::Context => raw_patch.push(' '),
               DiffLineType::Header => {}
            }
            raw_patch.push_str(&existing_line.content);
            if !existing_line.content.ends_with('\n') {
               raw_patch.push('\n');
            }
         }
         self.lines.clear();
         self.raw_patch = Some(raw_patch);
         self.push_raw_line(origin, content);
         return;
      }

      self.lines.push(line);
   }
}

pub fn parse_diff_to_lines(diff: &mut Diff) -> Result<Vec<GitDiffLine>, String> {
   let mut lines: Vec<GitDiffLine> = Vec::new();

   diff
      .print(DiffFormat::Patch, |_delta, _hunk, line| {
         let origin = line.origin();
         match origin {
            'F' | 'H' => {
               let content = String::from_utf8_lossy(line.content()).to_string();
               lines.push(GitDiffLine {
                  line_type: DiffLineType::Header,
                  content,
                  old_line_number: None,
                  new_line_number: None,
               });
            }
            '+' => {
               lines.push(GitDiffLine {
                  line_type: DiffLineType::Added,
                  content: String::from_utf8_lossy(line.content())
                     .trim_end_matches('\n')
                     .to_string(),
                  old_line_number: None,
                  new_line_number: line.new_lineno(),
               });
            }
            '-' => {
               lines.push(GitDiffLine {
                  line_type: DiffLineType::Removed,
                  content: String::from_utf8_lossy(line.content())
                     .trim_end_matches('\n')
                     .to_string(),
                  old_line_number: line.old_lineno(),
                  new_line_number: None,
               });
            }
            ' ' => {
               lines.push(GitDiffLine {
                  line_type: DiffLineType::Context,
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

fn diff_delta_file_path(delta: &git2::DiffDelta<'_>) -> String {
   if delta.status() == git2::Delta::Deleted {
      delta
         .old_file()
         .path()
         .map(|path| path.to_string_lossy().into_owned())
         .unwrap_or_default()
   } else {
      delta
         .new_file()
         .path()
         .or_else(|| delta.old_file().path())
         .map(|path| path.to_string_lossy().into_owned())
         .unwrap_or_default()
   }
}

fn parse_diff_to_file_entries(diff: &mut Diff) -> Result<HashMap<String, ParsedDiffFile>, String> {
   let mut file_entries: HashMap<String, ParsedDiffFile> = HashMap::new();

   diff
      .print(DiffFormat::Patch, |delta, _hunk, line| {
         let file_path = diff_delta_file_path(&delta);
         let entry = file_entries.entry(file_path).or_default();
         let origin = line.origin();
         let content = line.content();

         match origin {
            'F' | 'H' => {
               entry.push_line(
                  origin,
                  GitDiffLine {
                     line_type: DiffLineType::Header,
                     content: String::from_utf8_lossy(content).to_string(),
                     old_line_number: None,
                     new_line_number: None,
                  },
                  content,
               );
            }
            '+' => {
               entry.push_line(
                  origin,
                  GitDiffLine {
                     line_type: DiffLineType::Added,
                     content: String::from_utf8_lossy(content)
                        .trim_end_matches('\n')
                        .to_string(),
                     old_line_number: None,
                     new_line_number: line.new_lineno(),
                  },
                  content,
               );
            }
            '-' => {
               entry.push_line(
                  origin,
                  GitDiffLine {
                     line_type: DiffLineType::Removed,
                     content: String::from_utf8_lossy(content)
                        .trim_end_matches('\n')
                        .to_string(),
                     old_line_number: line.old_lineno(),
                     new_line_number: None,
                  },
                  content,
               );
            }
            ' ' => {
               entry.push_line(
                  origin,
                  GitDiffLine {
                     line_type: DiffLineType::Context,
                     content: String::from_utf8_lossy(content)
                        .trim_end_matches('\n')
                        .to_string(),
                     old_line_number: line.old_lineno(),
                     new_line_number: line.new_lineno(),
                  },
                  content,
               );
            }
            _ => {}
         }

         true
      })
      .map_err(|e| e.to_string())?;

   Ok(file_entries)
}

fn count_line_stats(lines: &[GitDiffLine]) -> (usize, usize) {
   let mut additions = 0;
   let mut deletions = 0;

   for line in lines {
      match line.line_type {
         DiffLineType::Added => additions += 1,
         DiffLineType::Removed => deletions += 1,
         _ => {}
      }
   }

   (additions, deletions)
}

fn collect_diff_stats(
   diff: &mut Diff,
   staged: bool,
) -> Result<HashMap<String, GitDiffStat>, String> {
   let mut stats_by_path: HashMap<String, GitDiffStat> = HashMap::new();

   diff
      .print(DiffFormat::Patch, |delta, _hunk, line| {
         let origin = line.origin();
         if origin != '+' && origin != '-' {
            return true;
         }

         let file_path = diff_delta_file_path(&delta);
         if file_path.is_empty() {
            return true;
         }

         let entry = stats_by_path
            .entry(file_path.clone())
            .or_insert_with(|| GitDiffStat {
               file_path,
               staged,
               additions: 0,
               deletions: 0,
            });

         if origin == '+' {
            entry.additions += 1;
         } else {
            entry.deletions += 1;
         }

         true
      })
      .map_err(|error| error.to_string())?;

   Ok(stats_by_path)
}

pub fn git_status_diff_stats(repo_path: String) -> Result<Vec<GitDiffStat>, String> {
   let repo =
      Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
   let head_tree = repo
      .head()
      .ok()
      .and_then(|head| head.peel_to_commit().ok())
      .and_then(|commit| commit.tree().ok());
   let index = repo
      .index()
      .map_err(|e| format!("Failed to get index: {e}"))?;

   let mut staged_diff = repo
      .diff_tree_to_index(head_tree.as_ref(), Some(&index), None)
      .map_err(|e| format!("Failed to create staged diff: {e}"))?;

   let mut unstaged_options = git2::DiffOptions::new();
   unstaged_options.include_untracked(true);
   unstaged_options.recurse_untracked_dirs(false);
   let mut unstaged_diff = repo
      .diff_index_to_workdir(Some(&index), Some(&mut unstaged_options))
      .map_err(|e| format!("Failed to create unstaged diff: {e}"))?;

   let mut stats = collect_diff_stats(&mut staged_diff, true)?;
   stats.extend(collect_diff_stats(&mut unstaged_diff, false)?);

   Ok(stats.into_values().collect())
}

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
      let index = repo
         .index()
         .map_err(|e| format!("Failed to get index: {e}"))?;
      repo.diff_index_to_workdir(Some(&index), Some(&mut diff_opts))
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
         let index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {e}"))?;
         repo.diff_index_to_workdir(Some(&index), Some(&mut broader_diff_opts))
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
                        let abs_path =
                           Path::new(&repo_path).join(new_path.as_deref().unwrap_or(&file_path));
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

               let (additions, deletions) = count_line_stats(&lines);

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
                  raw_patch: None,
                  additions: Some(additions),
                  deletions: Some(deletions),
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
            let abs_path = Path::new(&repo_path).join(new_path.as_deref().unwrap_or(&file_path));
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

   let (additions, deletions) = count_line_stats(&lines);

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
      raw_patch: None,
      additions: Some(additions),
      deletions: Some(deletions),
   })
}

fn create_diff_lines(old_lines: &[&str], new_lines: &[&str]) -> Vec<GitDiffLine> {
   let mut result = Vec::new();

   // Use a simple but effective diff algorithm based on LCS
   let lcs = longest_common_subsequence(old_lines, new_lines);
   let mut old_idx = 0;
   let mut new_idx = 0;
   let mut old_line_num = 1u32;
   let mut new_line_num = 1u32;

   for &(lcs_old_idx, lcs_new_idx) in &lcs {
      // Add removed lines before this LCS point
      while old_idx < lcs_old_idx {
         result.push(GitDiffLine {
            line_type: DiffLineType::Removed,
            content: old_lines[old_idx].to_string(),
            old_line_number: Some(old_line_num),
            new_line_number: None,
         });
         old_idx += 1;
         old_line_num += 1;
      }

      // Add added lines before this LCS point
      while new_idx < lcs_new_idx {
         result.push(GitDiffLine {
            line_type: DiffLineType::Added,
            content: new_lines[new_idx].to_string(),
            old_line_number: None,
            new_line_number: Some(new_line_num),
         });
         new_idx += 1;
         new_line_num += 1;
      }

      // Add the common line
      if old_idx < old_lines.len() && new_idx < new_lines.len() {
         result.push(GitDiffLine {
            line_type: DiffLineType::Context,
            content: old_lines[old_idx].to_string(),
            old_line_number: Some(old_line_num),
            new_line_number: Some(new_line_num),
         });
         old_idx += 1;
         new_idx += 1;
         old_line_num += 1;
         new_line_num += 1;
      }
   }

   // Add remaining removed lines
   while old_idx < old_lines.len() {
      result.push(GitDiffLine {
         line_type: DiffLineType::Removed,
         content: old_lines[old_idx].to_string(),
         old_line_number: Some(old_line_num),
         new_line_number: None,
      });
      old_idx += 1;
      old_line_num += 1;
   }

   // Add remaining added lines
   while new_idx < new_lines.len() {
      result.push(GitDiffLine {
         line_type: DiffLineType::Added,
         content: new_lines[new_idx].to_string(),
         old_line_number: None,
         new_line_number: Some(new_line_num),
      });
      new_idx += 1;
      new_line_num += 1;
   }

   result
}

fn longest_common_subsequence(old_lines: &[&str], new_lines: &[&str]) -> Vec<(usize, usize)> {
   let old_len = old_lines.len();
   let new_len = new_lines.len();

   if old_len == 0 || new_len == 0 {
      return Vec::new();
   }

   // Create LCS table
   let mut lcs_table = vec![vec![0; new_len + 1]; old_len + 1];

   for i in 1..=old_len {
      for j in 1..=new_len {
         if old_lines[i - 1] == new_lines[j - 1] {
            lcs_table[i][j] = lcs_table[i - 1][j - 1] + 1;
         } else {
            lcs_table[i][j] = std::cmp::max(lcs_table[i - 1][j], lcs_table[i][j - 1]);
         }
      }
   }

   // Backtrack to find the actual LCS
   let mut result = Vec::new();
   let mut i = old_len;
   let mut j = new_len;

   while i > 0 && j > 0 {
      if old_lines[i - 1] == new_lines[j - 1] {
         result.push((i - 1, j - 1));
         i -= 1;
         j -= 1;
      } else if lcs_table[i - 1][j] > lcs_table[i][j - 1] {
         i -= 1;
      } else {
         j -= 1;
      }
   }

   result.reverse();
   result
}

pub fn git_diff_file_with_content(
   repo_path: String,
   file_path: String,
   content: String,
   base: String, // "head" or "index"
) -> Result<GitDiff, String> {
   let repo =
      Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
   let is_image = is_image_file(&file_path);

   // Get the base tree/index to compare against
   let base_blob_id = if base == "index" {
      // Get blob from index
      let index = repo
         .index()
         .map_err(|e| format!("Failed to get index: {e}"))?;

      match index.get_path(Path::new(&file_path), 0) {
         Some(entry) => Some(entry.id),
         None => None, // File not in index, treat as new
      }
   } else {
      // Get blob from HEAD
      let head = repo
         .head()
         .map_err(|e| format!("Failed to get HEAD: {e}"))?;
      let head_commit = head
         .peel_to_commit()
         .map_err(|e| format!("Failed to peel to commit: {e}"))?;
      let head_tree = head_commit
         .tree()
         .map_err(|e| format!("Failed to get HEAD tree: {e}"))?;

      match head_tree.get_path(Path::new(&file_path)) {
         Ok(entry) => Some(entry.id()),
         Err(_) => None, // File not in HEAD, treat as new
      }
   };

   let is_new = base_blob_id.is_none();
   let is_deleted = content.is_empty() && !is_new;
   let is_renamed = false; // Can't detect renames with this method

   let mut old_blob_base64 = None;
   let mut new_blob_base64 = None;
   let mut lines = Vec::new();

   if is_image {
      // Handle binary/image files
      if let Some(blob_id) = base_blob_id {
         old_blob_base64 = get_blob_base64(&repo, Some(blob_id), &file_path);
      }
      if !content.is_empty() {
         new_blob_base64 = Some(general_purpose::STANDARD.encode(content.as_bytes()));
      }
   } else {
      // Handle text files - create diff between blob and buffer
      if let Some(blob_id) = base_blob_id {
         let blob = repo
            .find_blob(blob_id)
            .map_err(|e| format!("Failed to find blob: {e}"))?;

         // Create a diff between the blob and the content buffer
         // Create a proper diff between blob content and buffer content
         let old_content = blob.content();

         // Create a proper diff between blob content and buffer content
         let old_content_str = std::str::from_utf8(old_content).unwrap_or("");
         let old_lines: Vec<&str> = old_content_str.lines().collect();
         let new_lines: Vec<&str> = content.lines().collect();

         lines = create_diff_lines(&old_lines, &new_lines);
      } else if !content.is_empty() {
         // New file
         for (index, line) in content.lines().enumerate() {
            lines.push(GitDiffLine {
               line_type: DiffLineType::Added,
               content: line.to_string(),
               old_line_number: None,
               new_line_number: Some(index as u32 + 1),
            });
         }
      }
   }

   let (additions, deletions) = count_line_stats(&lines);

   Ok(GitDiff {
      file_path: file_path.clone(),
      old_path: Some(file_path.clone()),
      new_path: Some(file_path.clone()),
      is_new,
      is_deleted,
      is_renamed,
      is_binary: is_image,
      is_image,
      old_blob_base64,
      new_blob_base64,
      lines,
      raw_patch: None,
      additions: Some(additions),
      deletions: Some(deletions),
   })
}

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
   let mut diff = diff;
   let mut diff_entries_by_file = parse_diff_to_file_entries(&mut diff).unwrap_or_default();
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
      let mut raw_patch = None;
      let mut additions = 0;
      let mut deletions = 0;
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
         let parsed = diff_entries_by_file.remove(&file_path).unwrap_or_default();
         raw_patch = parsed.raw_patch;
         additions = parsed.additions;
         deletions = parsed.deletions;
         parsed.lines
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
         raw_patch,
         additions: Some(additions),
         deletions: Some(deletions),
      });
   }
   Ok(results)
}

pub fn git_ref_diff(
   repo_path: String,
   base_ref: String,
   target_ref: String,
) -> Result<Vec<GitDiff>, String> {
   let repo =
      Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
   let base_commit = repo
      .revparse_single(&base_ref)
      .map_err(|e| format!("Failed to find base ref '{base_ref}': {e}"))?
      .peel_to_commit()
      .map_err(|e| format!("Failed to peel base ref '{base_ref}' to commit: {e}"))?;
   let target_commit = repo
      .revparse_single(&target_ref)
      .map_err(|e| format!("Failed to find target ref '{target_ref}': {e}"))?
      .peel_to_commit()
      .map_err(|e| format!("Failed to peel target ref '{target_ref}' to commit: {e}"))?;
   let base_tree = base_commit
      .tree()
      .map_err(|e| format!("Failed to get base tree: {e}"))?;
   let target_tree = target_commit
      .tree()
      .map_err(|e| format!("Failed to get target tree: {e}"))?;

   git_diff_between_trees(&repo, Some(&base_tree), Some(&target_tree))
}

fn git_diff_between_trees(
   repo: &Repository,
   base_tree: Option<&Tree<'_>>,
   target_tree: Option<&Tree<'_>>,
) -> Result<Vec<GitDiff>, String> {
   let mut diff = repo
      .diff_tree_to_tree(base_tree, target_tree, None)
      .map_err(|e| format!("Failed to create ref diff: {e}"))?;
   let mut diff_entries_by_file = parse_diff_to_file_entries(&mut diff).unwrap_or_default();
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
      let mut raw_patch = None;
      let mut additions = 0;
      let mut deletions = 0;
      let lines = if is_image {
         is_binary = true;
         let old_oid = delta.old_file().id();
         let new_oid = delta.new_file().id();
         if is_new {
            new_blob_base64 =
               get_blob_base64(repo, Some(new_oid), new_path.as_deref().unwrap_or(""));
         } else if is_deleted {
            let old_blob_oid = base_tree.and_then(|tree| {
               old_path
                  .as_ref()
                  .and_then(|p| tree.get_path(Path::new(p)).ok().map(|e| e.id()))
            });
            old_blob_base64 = get_blob_base64(
               repo,
               old_blob_oid.or(Some(old_oid)),
               old_path.as_deref().unwrap_or(""),
            );
         } else if is_renamed {
            let old_blob_oid = base_tree.and_then(|tree| {
               old_path
                  .as_ref()
                  .and_then(|p| tree.get_path(Path::new(p)).ok().map(|e| e.id()))
            });
            old_blob_base64 = get_blob_base64(
               repo,
               old_blob_oid.or(Some(old_oid)),
               old_path.as_deref().unwrap_or(""),
            );
            new_blob_base64 =
               get_blob_base64(repo, Some(new_oid), new_path.as_deref().unwrap_or(""));
         } else {
            let old_blob_oid = base_tree.and_then(|tree| {
               old_path
                  .as_ref()
                  .and_then(|p| tree.get_path(Path::new(p)).ok().map(|e| e.id()))
            });
            old_blob_base64 = get_blob_base64(
               repo,
               old_blob_oid.or(Some(old_oid)),
               old_path.as_deref().unwrap_or(""),
            );
            new_blob_base64 =
               get_blob_base64(repo, Some(new_oid), new_path.as_deref().unwrap_or(""));
         }
         Vec::new()
      } else {
         let parsed = diff_entries_by_file.remove(&file_path).unwrap_or_default();
         raw_patch = parsed.raw_patch;
         additions = parsed.additions;
         deletions = parsed.deletions;
         parsed.lines
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
         raw_patch,
         additions: Some(additions),
         deletions: Some(deletions),
      });
   }

   Ok(results)
}
