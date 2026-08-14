use crate::git::{DiffLineType, GitDiff, GitDiffLine, GitDiffStat, get_blob_base64, is_image_file};
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use git2::{Blob, Diff, DiffDelta, DiffFormat, Oid, Patch, Repository, Tree};
use std::{
   collections::HashMap,
   io::Read,
   path::{Path, PathBuf},
};

const LARGE_DIFF_LINE_THRESHOLD: usize = 20_000;
const MAX_RAW_PATCH_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct ParsedDiffLines {
   pub lines: Vec<GitDiffLine>,
   pub is_truncated: bool,
}

#[derive(Default)]
struct ParsedDiffFile {
   lines: Vec<GitDiffLine>,
   raw_patch: Option<String>,
   additions: usize,
   deletions: usize,
   line_count: usize,
   is_truncated: bool,
}

impl ParsedDiffFile {
   fn push_raw_line(&mut self, origin: char, content: &[u8]) {
      let raw_patch = self.raw_patch.get_or_insert_with(String::new);
      if raw_patch.len() >= MAX_RAW_PATCH_BYTES {
         self.is_truncated = true;
         return;
      }

      match origin {
         '+' | '-' | ' ' => raw_patch.push(origin),
         _ => {}
      }

      let text = String::from_utf8_lossy(content);
      let remaining_bytes = MAX_RAW_PATCH_BYTES.saturating_sub(raw_patch.len());
      if text.len() > remaining_bytes {
         let mut end = remaining_bytes;
         while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
         }
         raw_patch.push_str(&text[..end]);
         raw_patch.push_str("\n# Athas truncated this diff to keep the editor responsive.\n");
         self.is_truncated = true;
         return;
      }

      raw_patch.push_str(&text);
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
         self.is_truncated = true;
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

pub fn parse_diff_to_lines(diff: &mut Diff) -> Result<ParsedDiffLines, String> {
   let mut lines: Vec<GitDiffLine> = Vec::new();
   let mut is_truncated = false;

   diff
      .print(DiffFormat::Patch, |_delta, _hunk, line| {
         if lines.len() >= LARGE_DIFF_LINE_THRESHOLD {
            if !is_truncated {
               lines.push(GitDiffLine {
                  line_type: DiffLineType::Header,
                  content: format!(
                     "Athas truncated this diff after {LARGE_DIFF_LINE_THRESHOLD} lines to keep \
                      the editor responsive."
                  ),
                  old_line_number: None,
                  new_line_number: None,
               });
               is_truncated = true;
            }
            return true;
         }

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

   Ok(ParsedDiffLines {
      lines,
      is_truncated,
   })
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

fn path_looks_binary(path: PathBuf) -> bool {
   let Ok(mut file) = std::fs::File::open(path) else {
      return false;
   };
   let mut sample = [0_u8; 8_000];
   let Ok(bytes_read) = file.read(&mut sample) else {
      return false;
   };

   sample[..bytes_read].contains(&0)
}

fn delta_is_binary(repo: &Repository, delta: &DiffDelta<'_>) -> bool {
   if delta.old_file().is_binary() || delta.new_file().is_binary() {
      return true;
   }

   for oid in [delta.old_file().id(), delta.new_file().id()] {
      if !oid.is_zero() && repo.find_blob(oid).is_ok_and(|blob| blob.is_binary()) {
         return true;
      }
   }

   repo
      .workdir()
      .zip(delta.new_file().path())
      .is_some_and(|(workdir, path)| path_looks_binary(workdir.join(path)))
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

   let head_tree = repo
      .head()
      .ok()
      .and_then(|head| head.peel_to_commit().ok())
      .and_then(|commit| commit.tree().ok());

   let mut diff_opts = git2::DiffOptions::new();
   diff_opts.pathspec(&file_path);

   let diff_result = if staged {
      let index = repo
         .index()
         .map_err(|e| format!("Failed to get index: {e}"))?;
      repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut diff_opts))
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
   let mut is_truncated = false;

   let deltas: Vec<_> = diff.deltas().collect();

   if deltas.is_empty() {
      let mut broader_diff_opts = git2::DiffOptions::new();
      let broader_diff_result = if staged {
         let index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {e}"))?;
         repo.diff_tree_to_index(
            head_tree.as_ref(),
            Some(&index),
            Some(&mut broader_diff_opts),
         )
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
               let is_binary = is_image || delta_is_binary(&repo, &delta);

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
               } else if !is_binary {
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
                        head_tree.as_ref(),
                        Some(&index),
                        Some(&mut single_file_opts),
                     )
                  } else {
                     repo.diff_tree_to_workdir(head_tree.as_ref(), Some(&mut single_file_opts))
                  };

                  if let Ok(mut single_diff) = single_diff_result {
                     let parsed = parse_diff_to_lines(&mut single_diff)?;
                     is_truncated = parsed.is_truncated;
                     lines = parsed.lines;
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
                  is_binary,
                  is_image,
                  old_blob_base64,
                  new_blob_base64,
                  lines,
                  raw_patch: None,
                  additions: Some(additions),
                  deletions: Some(deletions),
                  is_truncated: is_truncated.then_some(true),
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
   let is_binary = is_image || delta_is_binary(&repo, delta);

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
   } else if !is_binary {
      let parsed = parse_diff_to_lines(&mut diff)?;
      is_truncated = parsed.is_truncated;
      lines = parsed.lines;
   }

   let (additions, deletions) = count_line_stats(&lines);

   Ok(GitDiff {
      file_path: file_path.clone(),
      old_path,
      new_path,
      is_new,
      is_deleted,
      is_renamed,
      is_binary,
      is_image,
      old_blob_base64,
      new_blob_base64,
      lines,
      raw_patch: None,
      additions: Some(additions),
      deletions: Some(deletions),
      is_truncated: is_truncated.then_some(true),
   })
}

fn parse_content_patch(patch: &Patch<'_>) -> Result<ParsedDiffLines, String> {
   let mut lines = Vec::new();

   for hunk_index in 0..patch.num_hunks() {
      let (hunk, line_count) = patch.hunk(hunk_index).map_err(|error| error.to_string())?;
      lines.push(GitDiffLine {
         line_type: DiffLineType::Header,
         content: String::from_utf8_lossy(hunk.header())
            .trim_end_matches('\n')
            .to_string(),
         old_line_number: None,
         new_line_number: None,
      });

      for line_index in 0..line_count {
         if lines.len() >= LARGE_DIFF_LINE_THRESHOLD {
            lines.push(GitDiffLine {
               line_type: DiffLineType::Header,
               content: format!(
                  "Athas truncated this diff after {LARGE_DIFF_LINE_THRESHOLD} lines to keep the \
                   editor responsive."
               ),
               old_line_number: None,
               new_line_number: None,
            });
            return Ok(ParsedDiffLines {
               lines,
               is_truncated: true,
            });
         }

         let line = patch
            .line_in_hunk(hunk_index, line_index)
            .map_err(|error| error.to_string())?;
         let line_type = match line.origin() {
            '+' => DiffLineType::Added,
            '-' => DiffLineType::Removed,
            ' ' => DiffLineType::Context,
            _ => continue,
         };
         lines.push(GitDiffLine {
            line_type,
            content: String::from_utf8_lossy(line.content())
               .trim_end_matches('\n')
               .to_string(),
            old_line_number: line.old_lineno(),
            new_line_number: line.new_lineno(),
         });
      }
   }

   Ok(ParsedDiffLines {
      lines,
      is_truncated: false,
   })
}

fn diff_blob_against_content(
   blob: Option<&Blob<'_>>,
   file_path: &Path,
   content: &[u8],
) -> Result<ParsedDiffLines, String> {
   let mut options = git2::DiffOptions::new();
   options.context_lines(3);
   let patch = match blob {
      Some(blob) => Patch::from_blob_and_buffer(
         blob,
         Some(file_path),
         content,
         Some(file_path),
         Some(&mut options),
      ),
      None => Patch::from_buffers(
         &[],
         Some(file_path),
         content,
         Some(file_path),
         Some(&mut options),
      ),
   }
   .map_err(|error| format!("Failed to diff editor content: {error}"))?;

   parse_content_patch(&patch)
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
      repo
         .head()
         .ok()
         .and_then(|head| head.peel_to_commit().ok())
         .and_then(|commit| commit.tree().ok())
         .and_then(|tree| {
            tree
               .get_path(Path::new(&file_path))
               .ok()
               .map(|entry| entry.id())
         })
   };

   let is_new = base_blob_id.is_none();
   let is_deleted = content.is_empty() && !is_new;
   let is_renamed = false; // Can't detect renames with this method

   let base_blob = base_blob_id
      .map(|blob_id| {
         repo
            .find_blob(blob_id)
            .map_err(|e| format!("Failed to find blob: {e}"))
      })
      .transpose()?;
   let is_binary = is_image || base_blob.as_ref().is_some_and(|blob| blob.is_binary());
   let mut old_blob_base64 = None;
   let mut new_blob_base64 = None;
   let mut lines = Vec::new();
   let mut is_truncated = false;

   if is_binary {
      if let Some(blob_id) = base_blob_id {
         old_blob_base64 = get_blob_base64(&repo, Some(blob_id), &file_path);
      }
      if !content.is_empty() {
         new_blob_base64 = Some(general_purpose::STANDARD.encode(content.as_bytes()));
      }
   } else {
      let parsed = diff_blob_against_content(
         base_blob.as_ref(),
         Path::new(&file_path),
         content.as_bytes(),
      )?;
      lines = parsed.lines;
      is_truncated = parsed.is_truncated;
   }

   let (additions, deletions) = count_line_stats(&lines);

   Ok(GitDiff {
      file_path: file_path.clone(),
      old_path: Some(file_path.clone()),
      new_path: Some(file_path.clone()),
      is_new,
      is_deleted,
      is_renamed,
      is_binary,
      is_image,
      old_blob_base64,
      new_blob_base64,
      lines,
      raw_patch: None,
      additions: Some(additions),
      deletions: Some(deletions),
      is_truncated: is_truncated.then_some(true),
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
   git_diff_between_trees(
      &repo,
      parent_tree.as_ref(),
      Some(&commit_tree),
      file_path.as_deref(),
   )
}

pub fn git_file_at_commit(
   repo_path: String,
   commit_hash: String,
   file_path: String,
) -> Result<String, String> {
   let repo =
      Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
   let commit = repo
      .revparse_single(&commit_hash)
      .and_then(|object| object.peel_to_commit())
      .map_err(|e| format!("Commit not found: {e}"))?;
   let tree = commit
      .tree()
      .map_err(|e| format!("Failed to get commit tree: {e}"))?;
   let entry = tree
      .get_path(Path::new(&file_path))
      .map_err(|e| format!("File not found at {commit_hash}: {e}"))?;
   let blob = entry
      .to_object(&repo)
      .and_then(|object| object.peel_to_blob())
      .map_err(|e| format!("Failed to read file at {commit_hash}: {e}"))?;

   std::str::from_utf8(blob.content())
      .map(str::to_owned)
      .map_err(|_| format!("File is not valid UTF-8 at {commit_hash}: {file_path}"))
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

   git_diff_between_trees(&repo, Some(&base_tree), Some(&target_tree), None)
}

fn git_diff_between_trees(
   repo: &Repository,
   base_tree: Option<&Tree<'_>>,
   target_tree: Option<&Tree<'_>>,
   file_path: Option<&str>,
) -> Result<Vec<GitDiff>, String> {
   let mut options = git2::DiffOptions::new();
   if let Some(file_path) = file_path {
      options.pathspec(file_path);
   }
   let mut diff = repo
      .diff_tree_to_tree(base_tree, target_tree, Some(&mut options))
      .map_err(|e| format!("Failed to create tree diff: {e}"))?;
   let mut diff_entries_by_file = parse_diff_to_file_entries(&mut diff)?;
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
      let is_binary = is_image || delta_is_binary(repo, &delta);
      let mut old_blob_base64 = None;
      let mut new_blob_base64 = None;
      let is_new = delta.status() == git2::Delta::Added;
      let is_deleted = delta.status() == git2::Delta::Deleted;
      let is_renamed = delta.status() == git2::Delta::Renamed;
      let mut raw_patch = None;
      let mut additions = 0;
      let mut deletions = 0;
      let mut is_truncated = false;
      let lines = if is_image {
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
      } else if is_binary {
         Vec::new()
      } else {
         let parsed = diff_entries_by_file.remove(&file_path).unwrap_or_default();
         raw_patch = parsed.raw_patch;
         additions = parsed.additions;
         deletions = parsed.deletions;
         is_truncated = parsed.is_truncated;
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
         is_truncated: is_truncated.then_some(true),
      });
   }

   Ok(results)
}

#[cfg(test)]
mod tests {
   use super::*;
   use git2::IndexAddOption;
   use std::fs;

   #[test]
   fn content_diff_handles_large_similar_buffers_without_quadratic_table() {
      let old_content = (0..5_000)
         .map(|index| format!("line {index}\n"))
         .collect::<String>();
      let mut new_content = old_content.clone();
      new_content.push_str("new final line\n");

      let parsed = diff_blob_against_content(None, Path::new("large.txt"), new_content.as_bytes())
         .expect("content diff");

      assert!(!parsed.is_truncated);
      assert!(parsed.lines.iter().any(|line| {
         matches!(line.line_type, DiffLineType::Added) && line.content == "new final line"
      }));
   }

   #[test]
   fn content_diff_preserves_changed_line_numbers() {
      let patch = Patch::from_buffers(
         b"first\nold\nthird\n",
         Some(Path::new("example.txt")),
         b"first\nnew\nthird\n",
         Some(Path::new("example.txt")),
         None,
      )
      .expect("patch");
      let parsed = parse_content_patch(&patch).expect("parsed patch");

      let removed = parsed
         .lines
         .iter()
         .find(|line| matches!(line.line_type, DiffLineType::Removed))
         .expect("removed line");
      let added = parsed
         .lines
         .iter()
         .find(|line| matches!(line.line_type, DiffLineType::Added))
         .expect("added line");

      assert_eq!(removed.old_line_number, Some(2));
      assert_eq!(added.new_line_number, Some(2));
   }

   #[test]
   fn staged_diff_works_before_the_first_commit() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      fs::write(temp_dir.path().join("first.txt"), "first\n").expect("write file");
      let mut index = repo.index().expect("index");
      index
         .add_all(["first.txt"], IndexAddOption::DEFAULT, None)
         .expect("stage file");
      index.write().expect("write index");

      let diff = git_diff_file(
         temp_dir.path().to_string_lossy().into_owned(),
         "first.txt".to_string(),
         true,
      )
      .expect("staged diff");

      assert!(diff.is_new);
      assert!(
         diff.lines.iter().any(|line| {
            matches!(line.line_type, DiffLineType::Added) && line.content == "first"
         })
      );
   }

   #[test]
   fn staged_non_image_binary_diff_is_reported_without_text_lines() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      fs::write(
         temp_dir.path().join("payload.bin"),
         [0_u8, 159, 146, 150, 1, 2, 3],
      )
      .expect("write binary file");
      let mut index = repo.index().expect("index");
      index
         .add_all(["payload.bin"], IndexAddOption::DEFAULT, None)
         .expect("stage file");
      index.write().expect("write index");

      let diff = git_diff_file(
         temp_dir.path().to_string_lossy().into_owned(),
         "payload.bin".to_string(),
         true,
      )
      .expect("staged binary diff");

      assert!(diff.is_binary);
      assert!(!diff.is_image);
      assert!(diff.lines.is_empty());
      assert_eq!(diff.additions, Some(0));
      assert_eq!(diff.deletions, Some(0));
   }

   #[test]
   fn editor_content_diff_works_before_the_first_commit() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      Repository::init(temp_dir.path()).expect("repo init");

      let diff = git_diff_file_with_content(
         temp_dir.path().to_string_lossy().into_owned(),
         "first.txt".to_string(),
         "first\n".to_string(),
         "head".to_string(),
      )
      .expect("editor content diff");

      assert!(diff.is_new);
      assert_eq!(diff.additions, Some(1));
   }

   #[test]
   fn reads_file_content_from_a_specific_commit() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      fs::write(temp_dir.path().join("example.rs"), "fn first() {}\n").expect("write file");
      let mut index = repo.index().expect("index");
      index
         .add_all(["example.rs"], IndexAddOption::DEFAULT, None)
         .expect("stage file");
      index.write().expect("write index");
      let tree_id = index.write_tree().expect("write tree");
      let tree = repo.find_tree(tree_id).expect("find tree");
      let signature = git2::Signature::now("Athas", "athas@example.com").expect("signature");
      let commit_id = repo
         .commit(Some("HEAD"), &signature, &signature, "first", &tree, &[])
         .expect("commit");

      fs::write(temp_dir.path().join("example.rs"), "fn changed() {}\n").expect("change file");

      let content = git_file_at_commit(
         temp_dir.path().to_string_lossy().into_owned(),
         commit_id.to_string(),
         "example.rs".to_string(),
      )
      .expect("file at commit");

      assert_eq!(content, "fn first() {}\n");
   }
}
