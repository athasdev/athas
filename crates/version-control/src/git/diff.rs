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

   let mut stats: Vec<GitDiffStat> = collect_diff_stats(&mut staged_diff, true)?
      .into_values()
      .collect();
   stats.extend(collect_diff_stats(&mut unstaged_diff, false)?.into_values());

   Ok(stats)
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
                  single_file_opts
                     .pathspec(target_path)
                     .disable_pathspec_match(true);

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
   use git2::{IndexAddOption, Signature};
   use std::fs;
   use tempfile::TempDir;

   const PNG_V1: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDRv1";
   const PNG_V2: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDRv2-changed";

   struct Fixture {
      dir: TempDir,
      repo: Repository,
   }

   impl Fixture {
      fn new() -> Self {
         let dir = tempfile::tempdir().expect("temp dir");
         let repo = Repository::init(dir.path()).expect("repo init");
         {
            let mut config = repo.config().expect("config");
            config.set_bool("core.autocrlf", false).expect("autocrlf");
         }
         Self { dir, repo }
      }

      fn path(&self) -> String {
         self.dir.path().to_string_lossy().into_owned()
      }

      fn write(&self, name: &str, contents: impl AsRef<[u8]>) {
         let path = self.dir.path().join(name);
         if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
         }
         fs::write(path, contents).expect("write file");
      }

      fn remove(&self, name: &str) {
         fs::remove_file(self.dir.path().join(name)).expect("remove file");
      }

      fn stage(&self, name: &str) {
         let mut index = self.repo.index().expect("index");
         index.add_path(Path::new(name)).expect("stage path");
         index.write().expect("write index");
      }

      fn stage_removal(&self, name: &str) {
         let mut index = self.repo.index().expect("index");
         index.remove_path(Path::new(name)).expect("unstage path");
         index.write().expect("write index");
      }

      fn commit_all(&self, message: &str) -> Oid {
         let mut index = self.repo.index().expect("index");
         index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("stage all");
         index.update_all(["*"], None).expect("update all");
         index.write().expect("write index");
         let tree = self
            .repo
            .find_tree(index.write_tree().expect("write tree"))
            .expect("find tree");
         let signature = Signature::now("Athas", "athas@example.com").expect("signature");
         let parent = self
            .repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok());
         let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
         self
            .repo
            .commit(
               Some("HEAD"),
               &signature,
               &signature,
               message,
               &tree,
               &parents,
            )
            .expect("commit")
      }

      fn diff(&self, file_path: &str, staged: bool) -> GitDiff {
         git_diff_file(self.path(), file_path.to_string(), staged).expect("file diff")
      }

      fn content_diff(&self, file_path: &str, content: &str, base: &str) -> GitDiff {
         git_diff_file_with_content(
            self.path(),
            file_path.to_string(),
            content.to_string(),
            base.to_string(),
         )
         .expect("content diff")
      }
   }

   fn encode(bytes: &[u8]) -> String {
      general_purpose::STANDARD.encode(bytes)
   }

   fn numbered_lines(count: usize) -> String {
      (0..count).map(|index| format!("line {index}\n")).collect()
   }

   fn find_line<'a>(lines: &'a [GitDiffLine], kind: &str, content: &str) -> &'a GitDiffLine {
      lines
         .iter()
         .find(|line| {
            let matches_kind = match line.line_type {
               DiffLineType::Added => kind == "+",
               DiffLineType::Removed => kind == "-",
               DiffLineType::Context => kind == " ",
               DiffLineType::Header => kind == "h",
            };
            matches_kind && line.content == content
         })
         .unwrap_or_else(|| panic!("missing {kind:?} line {content:?}"))
   }

   fn hunk_headers(lines: &[GitDiffLine]) -> Vec<&str> {
      lines
         .iter()
         .filter(|line| {
            matches!(line.line_type, DiffLineType::Header) && line.content.starts_with("@@")
         })
         .map(|line| line.content.trim_end())
         .collect()
   }

   fn find_diff<'a>(diffs: &'a [GitDiff], file_path: &str) -> &'a GitDiff {
      diffs
         .iter()
         .find(|diff| diff.file_path == file_path)
         .unwrap_or_else(|| panic!("missing diff for {file_path}"))
   }

   #[test]
   fn unstaged_modification_reports_lines_with_numbers_and_stats() {
      let fixture = Fixture::new();
      fixture.write("notes.txt", "one\ntwo\nthree\n");
      fixture.commit_all("initial");
      fixture.write("notes.txt", "one\nTWO\nthree\nfour\n");

      let diff = fixture.diff("notes.txt", false);

      assert_eq!(diff.file_path, "notes.txt");
      assert_eq!(diff.old_path.as_deref(), Some("notes.txt"));
      assert_eq!(diff.new_path.as_deref(), Some("notes.txt"));
      assert!(!diff.is_new && !diff.is_deleted && !diff.is_renamed);
      assert!(!diff.is_binary && !diff.is_image);
      assert!(diff.old_blob_base64.is_none() && diff.new_blob_base64.is_none());
      assert_eq!(diff.raw_patch, None);
      assert_eq!(diff.is_truncated, None);
      assert_eq!(diff.additions, Some(2));
      assert_eq!(diff.deletions, Some(1));
      assert!(
         diff.lines[0]
            .content
            .starts_with("diff --git a/notes.txt b/notes.txt"),
         "first line should be the file header"
      );
      assert_eq!(hunk_headers(&diff.lines), vec!["@@ -1,3 +1,4 @@"]);

      let context = find_line(&diff.lines, " ", "one");
      assert_eq!(
         (context.old_line_number, context.new_line_number),
         (Some(1), Some(1))
      );
      let removed = find_line(&diff.lines, "-", "two");
      assert_eq!(
         (removed.old_line_number, removed.new_line_number),
         (Some(2), None)
      );
      let added = find_line(&diff.lines, "+", "TWO");
      assert_eq!(
         (added.old_line_number, added.new_line_number),
         (None, Some(2))
      );
      assert_eq!(find_line(&diff.lines, "+", "four").new_line_number, Some(4));
   }

   #[test]
   fn unstaged_deletion_is_reported_as_deleted_with_removed_lines() {
      let fixture = Fixture::new();
      fixture.write("gone.txt", "a\nb\n");
      fixture.commit_all("initial");
      fixture.remove("gone.txt");

      let diff = fixture.diff("gone.txt", false);

      assert!(diff.is_deleted);
      assert!(!diff.is_new);
      assert_eq!(diff.additions, Some(0));
      assert_eq!(diff.deletions, Some(2));
      assert_eq!(find_line(&diff.lines, "-", "b").old_line_number, Some(2));
   }

   #[test]
   fn staged_deletion_is_reported_as_deleted() {
      let fixture = Fixture::new();
      fixture.write("gone.txt", "a\nb\nc\n");
      fixture.commit_all("initial");
      fixture.remove("gone.txt");
      fixture.stage_removal("gone.txt");

      let diff = fixture.diff("gone.txt", true);

      assert!(diff.is_deleted);
      assert_eq!(diff.deletions, Some(3));
      assert_eq!(diff.new_path.as_deref(), Some("gone.txt"));
   }

   #[test]
   fn staged_and_unstaged_diffs_show_their_own_side_of_a_partially_staged_file() {
      let fixture = Fixture::new();
      fixture.write("partial.txt", "base\n");
      fixture.commit_all("initial");
      fixture.write("partial.txt", "staged\n");
      fixture.stage("partial.txt");
      fixture.write("partial.txt", "unstaged\n");

      let staged = fixture.diff("partial.txt", true);
      find_line(&staged.lines, "-", "base");
      find_line(&staged.lines, "+", "staged");
      assert!(!staged.lines.iter().any(|line| line.content == "unstaged"));

      let unstaged = fixture.diff("partial.txt", false);
      find_line(&unstaged.lines, "-", "staged");
      find_line(&unstaged.lines, "+", "unstaged");
      assert!(!unstaged.lines.iter().any(|line| line.content == "base"));
   }

   #[test]
   fn unchanged_file_returns_no_changes_error() {
      let fixture = Fixture::new();
      fixture.write("same.txt", "same\n");
      fixture.commit_all("initial");

      let staged = git_diff_file(fixture.path(), "same.txt".to_string(), true);
      let unstaged = git_diff_file(fixture.path(), "same.txt".to_string(), false);

      for result in [staged, unstaged] {
         let error = result.err().expect("expected an error");
         assert!(
            error.starts_with("No changes found for file: same.txt"),
            "{error}"
         );
      }
   }

   #[test]
   fn diff_functions_report_unopenable_repositories() {
      let dir = tempfile::tempdir().expect("temp dir");
      let path = dir.path().join("missing").to_string_lossy().into_owned();

      let errors = [
         git_diff_file(path.clone(), "a.txt".to_string(), false).err(),
         git_diff_file_with_content(
            path.clone(),
            "a.txt".to_string(),
            String::new(),
            "head".to_string(),
         )
         .err(),
         git_status_diff_stats(path.clone()).err(),
         git_commit_diff(path.clone(), "0".repeat(40), None).err(),
         git_file_at_commit(path.clone(), "HEAD".to_string(), "a.txt".to_string()).err(),
         git_ref_diff(path, "HEAD".to_string(), "HEAD".to_string()).err(),
      ];

      for error in errors {
         let error = error.expect("expected an error");
         assert!(error.starts_with("Failed to open repository"), "{error}");
      }
   }

   #[test]
   fn missing_trailing_newline_markers_are_not_rendered_as_content() {
      let fixture = Fixture::new();
      fixture.write("eof.txt", "keep\nold");
      fixture.commit_all("initial");
      fixture.write("eof.txt", "keep\nnew");

      let diff = fixture.diff("eof.txt", false);

      assert_eq!(diff.additions, Some(1));
      assert_eq!(diff.deletions, Some(1));
      find_line(&diff.lines, "-", "old");
      find_line(&diff.lines, "+", "new");
      assert!(
         !diff
            .lines
            .iter()
            .any(|line| line.content.contains("No newline at end of file"))
      );
   }

   #[test]
   fn unicode_content_is_preserved() {
      let fixture = Fixture::new();
      fixture.write("unicode.txt", "héllo\nwörld\n");
      fixture.commit_all("initial");
      fixture.write("unicode.txt", "héllo\nwörld 🌍\n日本語\n");

      let diff = fixture.diff("unicode.txt", false);

      find_line(&diff.lines, " ", "héllo");
      find_line(&diff.lines, "-", "wörld");
      find_line(&diff.lines, "+", "wörld 🌍");
      assert_eq!(
         find_line(&diff.lines, "+", "日本語").new_line_number,
         Some(3)
      );
   }

   #[test]
   fn distant_changes_produce_separate_hunks() {
      let fixture = Fixture::new();
      let original = numbered_lines(40);
      fixture.write("hunks.txt", &original);
      fixture.commit_all("initial");
      fixture.write(
         "hunks.txt",
         original
            .replace("line 2\n", "line two\n")
            .replace("line 35\n", "line thirty-five\n"),
      );

      let diff = fixture.diff("hunks.txt", false);

      assert_eq!(
         hunk_headers(&diff.lines),
         vec!["@@ -1,6 +1,6 @@", "@@ -33,7 +33,7 @@ line 31"]
      );
      assert_eq!(
         find_line(&diff.lines, "+", "line thirty-five").new_line_number,
         Some(36)
      );
   }

   #[test]
   fn unstaged_text_file_overwritten_with_binary_is_reported_as_binary() {
      let fixture = Fixture::new();
      fixture.write("data.dat", "plain text\n");
      fixture.commit_all("initial");
      fixture.write("data.dat", [1_u8, 0, 2, 0, 3]);

      let diff = fixture.diff("data.dat", false);

      assert!(diff.is_binary);
      assert!(!diff.is_image);
      assert!(diff.lines.is_empty());
      assert_eq!(diff.additions, Some(0));
   }

   #[test]
   fn staged_diff_is_truncated_after_the_line_threshold() {
      let fixture = Fixture::new();
      fixture.write("huge.txt", numbered_lines(LARGE_DIFF_LINE_THRESHOLD + 50));
      fixture.stage("huge.txt");

      let diff = fixture.diff("huge.txt", true);

      assert_eq!(diff.is_truncated, Some(true));
      assert_eq!(diff.lines.len(), LARGE_DIFF_LINE_THRESHOLD + 1);
      let marker = diff.lines.last().expect("truncation marker");
      assert!(matches!(marker.line_type, DiffLineType::Header));
      assert!(marker.content.contains("truncated"));
      assert!(diff.additions.expect("additions") < LARGE_DIFF_LINE_THRESHOLD);
   }

   #[test]
   fn unstaged_image_modification_returns_both_versions() {
      let fixture = Fixture::new();
      fixture.write("logo.png", PNG_V1);
      fixture.commit_all("initial");
      fixture.write("logo.png", PNG_V2);

      let diff = fixture.diff("logo.png", false);

      assert!(diff.is_image && diff.is_binary);
      assert!(diff.lines.is_empty());
      assert_eq!(diff.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(diff.new_blob_base64, Some(encode(PNG_V2)));
   }

   #[test]
   fn staged_image_modification_reads_both_versions_from_the_object_store() {
      let fixture = Fixture::new();
      fixture.write("logo.png", PNG_V1);
      fixture.commit_all("initial");
      fixture.write("logo.png", PNG_V2);
      fixture.stage("logo.png");
      fixture.write("logo.png", b"unstaged bytes on disk");

      let diff = fixture.diff("logo.png", true);

      assert_eq!(diff.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(diff.new_blob_base64, Some(encode(PNG_V2)));
   }

   #[test]
   fn staged_new_image_has_only_a_new_version() {
      let fixture = Fixture::new();
      fixture.write("icon.PNG", PNG_V1);
      fixture.stage("icon.PNG");

      let diff = fixture.diff("icon.PNG", true);

      assert!(diff.is_new && diff.is_image);
      assert_eq!(diff.old_blob_base64, None);
      assert_eq!(diff.new_blob_base64, Some(encode(PNG_V1)));
   }

   #[test]
   fn deleted_image_has_only_an_old_version() {
      let fixture = Fixture::new();
      fixture.write("old.jpg", PNG_V1);
      fixture.commit_all("initial");
      fixture.remove("old.jpg");

      let unstaged = fixture.diff("old.jpg", false);
      assert!(unstaged.is_deleted && unstaged.is_image);
      assert_eq!(unstaged.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(unstaged.new_blob_base64, None);

      fixture.stage_removal("old.jpg");
      let staged = fixture.diff("old.jpg", true);
      assert!(staged.is_deleted);
      assert_eq!(staged.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(staged.new_blob_base64, None);
   }

   #[test]
   fn status_diff_stats_count_staged_and_unstaged_changes() {
      let fixture = Fixture::new();
      fixture.write("edited.txt", "a\nb\nc\n");
      fixture.write("removed.txt", "x\ny\n");
      fixture.commit_all("initial");
      fixture.write("edited.txt", "a\nB\nc\nd\n");
      fixture.write("removed.txt", "");
      fixture.remove("removed.txt");
      fixture.stage_removal("removed.txt");
      fixture.write("added.txt", "1\n2\n3\n");
      fixture.stage("added.txt");

      let mut stats = git_status_diff_stats(fixture.path()).expect("stats");
      stats.sort_by(|a, b| a.file_path.cmp(&b.file_path));
      let summary: Vec<_> = stats
         .iter()
         .map(|stat| {
            (
               stat.file_path.as_str(),
               stat.staged,
               stat.additions,
               stat.deletions,
            )
         })
         .collect();

      assert_eq!(
         summary,
         vec![
            ("added.txt", true, 3, 0),
            ("edited.txt", false, 2, 1),
            ("removed.txt", true, 0, 2),
         ]
      );
   }

   #[test]
   fn status_diff_stats_keep_both_sides_of_a_partially_staged_file() {
      let fixture = Fixture::new();
      fixture.write("partial.txt", "one\ntwo\n");
      fixture.commit_all("initial");
      fixture.write("partial.txt", "one\ntwo\nthree\n");
      fixture.stage("partial.txt");
      fixture.write("partial.txt", "two\nthree\n");

      let mut stats = git_status_diff_stats(fixture.path()).expect("stats");
      stats.sort_by_key(|stat| !stat.staged);
      let summary: Vec<_> = stats
         .iter()
         .map(|stat| {
            (
               stat.file_path.as_str(),
               stat.staged,
               stat.additions,
               stat.deletions,
            )
         })
         .collect();

      assert_eq!(
         summary,
         vec![("partial.txt", true, 1, 0), ("partial.txt", false, 0, 1)]
      );
   }

   #[test]
   fn status_diff_stats_work_without_a_head_commit() {
      let fixture = Fixture::new();
      fixture.write("first.txt", "a\nb\n");
      fixture.stage("first.txt");

      let stats = git_status_diff_stats(fixture.path()).expect("stats");

      assert_eq!(stats.len(), 1);
      assert_eq!(stats[0].file_path, "first.txt");
      assert!(stats[0].staged);
      assert_eq!((stats[0].additions, stats[0].deletions), (2, 0));
   }

   #[test]
   fn content_diff_against_head_reports_hunks_and_line_numbers() {
      let fixture = Fixture::new();
      fixture.write("src.rs", "fn a() {}\nfn b() {}\nfn c() {}\n");
      fixture.commit_all("initial");

      let diff = fixture.content_diff("src.rs", "fn a() {}\nfn B() {}\nfn c() {}\n", "head");

      assert!(!diff.is_new && !diff.is_deleted && !diff.is_renamed && !diff.is_binary);
      assert_eq!(diff.old_path.as_deref(), Some("src.rs"));
      assert_eq!(diff.new_path.as_deref(), Some("src.rs"));
      assert_eq!(hunk_headers(&diff.lines), vec!["@@ -1,3 +1,3 @@"]);
      assert_eq!(diff.lines[0].content, "@@ -1,3 +1,3 @@");
      assert_eq!(
         find_line(&diff.lines, "-", "fn b() {}").old_line_number,
         Some(2)
      );
      assert_eq!(
         find_line(&diff.lines, "+", "fn B() {}").new_line_number,
         Some(2)
      );
      let context = find_line(&diff.lines, " ", "fn c() {}");
      assert_eq!(
         (context.old_line_number, context.new_line_number),
         (Some(3), Some(3))
      );
      assert_eq!((diff.additions, diff.deletions), (Some(1), Some(1)));
      assert_eq!(diff.is_truncated, None);
   }

   #[test]
   fn content_diff_uses_the_requested_base() {
      let fixture = Fixture::new();
      fixture.write("file.txt", "committed\n");
      fixture.commit_all("initial");
      fixture.write("file.txt", "staged\n");
      fixture.stage("file.txt");

      let against_index = fixture.content_diff("file.txt", "staged\n", "index");
      assert!(against_index.lines.is_empty());
      assert_eq!(
         (against_index.additions, against_index.deletions),
         (Some(0), Some(0))
      );

      let against_head = fixture.content_diff("file.txt", "staged\n", "head");
      find_line(&against_head.lines, "-", "committed");
      find_line(&against_head.lines, "+", "staged");
   }

   #[test]
   fn content_diff_treats_files_missing_from_the_base_as_new() {
      let fixture = Fixture::new();
      fixture.write("tracked.txt", "x\n");
      fixture.commit_all("initial");

      let diff = fixture.content_diff("untracked.txt", "a\nb\n", "index");

      assert!(diff.is_new);
      assert!(!diff.is_deleted);
      assert_eq!(diff.additions, Some(2));
      assert_eq!(hunk_headers(&diff.lines), vec!["@@ -0,0 +1,2 @@"]);
   }

   #[test]
   fn empty_content_for_a_tracked_file_is_reported_as_deleted() {
      let fixture = Fixture::new();
      fixture.write("file.txt", "a\nb\nc\n");
      fixture.commit_all("initial");

      let diff = fixture.content_diff("file.txt", "", "head");

      assert!(diff.is_deleted);
      assert!(!diff.is_new);
      assert_eq!((diff.additions, diff.deletions), (Some(0), Some(3)));
   }

   #[test]
   fn content_diff_against_a_binary_base_returns_encoded_versions() {
      let fixture = Fixture::new();
      fixture.write("blob.bin", [0_u8, 1, 2, 3]);
      fixture.commit_all("initial");

      let diff = fixture.content_diff("blob.bin", "text", "head");

      assert!(diff.is_binary);
      assert!(!diff.is_image);
      assert!(diff.lines.is_empty());
      assert_eq!(diff.old_blob_base64, Some(encode(&[0, 1, 2, 3])));
      assert_eq!(diff.new_blob_base64, Some(encode(b"text")));
   }

   #[test]
   fn content_diff_for_images_skips_line_parsing() {
      let fixture = Fixture::new();
      fixture.write("pic.svg", "<svg></svg>\n");
      fixture.commit_all("initial");

      let deleted = fixture.content_diff("pic.svg", "", "head");
      assert!(deleted.is_image && deleted.is_binary && deleted.is_deleted);
      assert!(deleted.lines.is_empty());
      assert_eq!(deleted.old_blob_base64, Some(encode(b"<svg></svg>\n")));
      assert_eq!(deleted.new_blob_base64, None);

      let new_image = fixture.content_diff("new.svg", "<svg/>", "head");
      assert!(new_image.is_new && new_image.is_image);
      assert_eq!(new_image.old_blob_base64, None);
      assert_eq!(new_image.new_blob_base64, Some(encode(b"<svg/>")));
   }

   #[test]
   fn content_diff_against_identical_blob_has_no_lines() {
      let fixture = Fixture::new();
      fixture.write("same.txt", "same\n");
      fixture.commit_all("initial");

      let diff = fixture.content_diff("same.txt", "same\n", "head");

      assert!(diff.lines.is_empty());
      assert!(!diff.is_deleted);
   }

   #[test]
   fn content_diff_is_truncated_after_the_line_threshold() {
      let content = numbered_lines(LARGE_DIFF_LINE_THRESHOLD + 10);

      let parsed = diff_blob_against_content(None, Path::new("big.txt"), content.as_bytes())
         .expect("content diff");

      assert!(parsed.is_truncated);
      assert_eq!(parsed.lines.len(), LARGE_DIFF_LINE_THRESHOLD + 1);
      let marker = parsed.lines.last().expect("marker");
      assert!(matches!(marker.line_type, DiffLineType::Header));
      assert!(marker.content.contains("truncated"));
   }

   #[test]
   fn commit_diff_of_root_commit_lists_every_file_as_new() {
      let fixture = Fixture::new();
      fixture.write("a.txt", "a1\na2\n");
      fixture.write("dir/b.txt", "b1\n");
      let commit = fixture.commit_all("initial");

      let diffs = git_commit_diff(fixture.path(), commit.to_string(), None).expect("commit diff");

      assert_eq!(diffs.len(), 2);
      let a = find_diff(&diffs, "a.txt");
      assert!(a.is_new);
      assert_eq!(a.old_path.as_deref(), Some("a.txt"));
      assert_eq!((a.additions, a.deletions), (Some(2), Some(0)));
      assert_eq!(find_line(&a.lines, "+", "a2").new_line_number, Some(2));
      assert!(a.lines[0].content.starts_with("diff --git a/a.txt b/a.txt"));
      let b = find_diff(&diffs, "dir/b.txt");
      assert!(b.is_new);
      assert_eq!(b.additions, Some(1));
   }

   #[test]
   fn commit_diff_reports_added_modified_and_deleted_files() {
      let fixture = Fixture::new();
      fixture.write("keep.txt", "one\ntwo\n");
      fixture.write("drop.txt", "bye\n");
      fixture.commit_all("initial");
      fixture.write("keep.txt", "one\n2\n");
      fixture.remove("drop.txt");
      fixture.write("new.txt", "hi\n");
      let commit = fixture.commit_all("second");

      let diffs = git_commit_diff(fixture.path(), commit.to_string(), None).expect("commit diff");

      assert_eq!(diffs.len(), 3);
      let modified = find_diff(&diffs, "keep.txt");
      assert!(!modified.is_new && !modified.is_deleted);
      assert_eq!((modified.additions, modified.deletions), (Some(1), Some(1)));
      assert_eq!(
         find_line(&modified.lines, "-", "two").old_line_number,
         Some(2)
      );
      assert_eq!(
         find_line(&modified.lines, "+", "2").new_line_number,
         Some(2)
      );
      assert_eq!(modified.raw_patch, None);

      let deleted = find_diff(&diffs, "drop.txt");
      assert!(deleted.is_deleted);
      assert_eq!((deleted.additions, deleted.deletions), (Some(0), Some(1)));
      find_line(&deleted.lines, "-", "bye");

      let added = find_diff(&diffs, "new.txt");
      assert!(added.is_new);
      assert_eq!(added.additions, Some(1));
   }

   #[test]
   fn commit_diff_can_be_limited_to_one_file() {
      let fixture = Fixture::new();
      fixture.write("a.txt", "a\n");
      fixture.write("b.txt", "b\n");
      let commit = fixture.commit_all("initial");

      let diffs = git_commit_diff(
         fixture.path(),
         commit.to_string(),
         Some("b.txt".to_string()),
      )
      .expect("commit diff");

      assert_eq!(diffs.len(), 1);
      assert_eq!(diffs[0].file_path, "b.txt");
   }

   #[test]
   fn commit_diff_rejects_bad_hashes() {
      let fixture = Fixture::new();
      fixture.write("a.txt", "a\n");
      fixture.commit_all("initial");

      let invalid = git_commit_diff(fixture.path(), "not-a-hash".to_string(), None)
         .err()
         .expect("invalid hash error");
      assert!(invalid.starts_with("Invalid commit hash"), "{invalid}");

      let missing = git_commit_diff(fixture.path(), "1".repeat(40), None)
         .err()
         .expect("missing commit error");
      assert!(missing.starts_with("Commit not found"), "{missing}");
   }

   #[test]
   fn commit_diff_reports_binary_and_image_files_without_lines() {
      let fixture = Fixture::new();
      fixture.write("modified.png", PNG_V1);
      fixture.write("deleted.gif", PNG_V1);
      fixture.write("payload.bin", [0_u8, 1, 2]);
      fixture.commit_all("initial");
      fixture.write("modified.png", PNG_V2);
      fixture.remove("deleted.gif");
      fixture.write("added.webp", PNG_V2);
      fixture.write("payload.bin", [0_u8, 9, 9, 9]);
      let commit = fixture.commit_all("images");

      let diffs = git_commit_diff(fixture.path(), commit.to_string(), None).expect("commit diff");

      assert_eq!(diffs.len(), 4);
      for diff in &diffs {
         assert!(diff.is_binary, "{} should be binary", diff.file_path);
         assert!(diff.lines.is_empty());
         assert_eq!(diff.additions, Some(0));
      }

      let modified = find_diff(&diffs, "modified.png");
      assert!(modified.is_image);
      assert_eq!(modified.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(modified.new_blob_base64, Some(encode(PNG_V2)));

      let deleted = find_diff(&diffs, "deleted.gif");
      assert!(deleted.is_deleted);
      assert_eq!(deleted.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(deleted.new_blob_base64, None);

      let added = find_diff(&diffs, "added.webp");
      assert!(added.is_new);
      assert_eq!(added.old_blob_base64, None);
      assert_eq!(added.new_blob_base64, Some(encode(PNG_V2)));

      let binary = find_diff(&diffs, "payload.bin");
      assert!(!binary.is_image);
      assert!(binary.old_blob_base64.is_none() && binary.new_blob_base64.is_none());
   }

   #[test]
   fn commit_diff_switches_large_files_to_a_raw_patch() {
      let fixture = Fixture::new();
      let line_count = LARGE_DIFF_LINE_THRESHOLD + 50;
      fixture.write("huge.txt", "kept\nremoved\n");
      fixture.commit_all("initial");
      fixture.write("huge.txt", format!("kept\n{}", numbered_lines(line_count)));
      fixture.write("small.txt", "small\n");
      let commit = fixture.commit_all("huge");

      let diffs = git_commit_diff(fixture.path(), commit.to_string(), None).expect("commit diff");

      let huge = find_diff(&diffs, "huge.txt");
      assert!(huge.lines.is_empty());
      assert_eq!(huge.is_truncated, Some(true));
      assert_eq!(huge.additions, Some(line_count));
      assert_eq!(huge.deletions, Some(1));
      let raw_patch = huge.raw_patch.as_deref().expect("raw patch");
      assert!(raw_patch.starts_with("diff --git a/huge.txt b/huge.txt"));
      assert!(raw_patch.contains("\n kept\n-removed\n+line 0\n"));
      assert!(raw_patch.ends_with(&format!("+line {}\n", line_count - 1)));
      assert!(!raw_patch.contains("Athas truncated"));

      let small = find_diff(&diffs, "small.txt");
      assert_eq!(small.raw_patch, None);
      assert_eq!(small.is_truncated, None);
      assert_eq!(small.lines.len(), 3);
   }

   #[test]
   fn raw_patch_is_capped_at_the_byte_limit_on_a_char_boundary() {
      let mut file = ParsedDiffFile {
         raw_patch: Some("x".repeat(MAX_RAW_PATCH_BYTES - 4)),
         ..ParsedDiffFile::default()
      };
      let line = || GitDiffLine {
         line_type: DiffLineType::Added,
         content: String::new(),
         old_line_number: None,
         new_line_number: None,
      };

      file.push_line('+', line(), "ééé\n".as_bytes());

      let raw_patch = file.raw_patch.clone().expect("raw patch");
      assert!(file.is_truncated);
      assert!(
         raw_patch.ends_with("+é\n# Athas truncated this diff to keep the editor responsive.\n")
      );
      assert_eq!(file.additions, 1);

      file.push_line('-', line(), b"ignored\n");
      assert_eq!(file.raw_patch.as_deref(), Some(raw_patch.as_str()));
      assert_eq!(file.deletions, 1);
      assert_eq!(file.line_count, 2);
   }

   #[test]
   fn ref_diff_compares_two_revisions() {
      let fixture = Fixture::new();
      fixture.write("file.txt", "v1\n");
      fixture.commit_all("first");
      fixture.write("file.txt", "v2\n");
      fixture.write("other.txt", "other\n");
      fixture.commit_all("second");

      let diffs =
         git_ref_diff(fixture.path(), "HEAD~1".to_string(), "HEAD".to_string()).expect("ref diff");

      assert_eq!(diffs.len(), 2);
      let file = find_diff(&diffs, "file.txt");
      find_line(&file.lines, "-", "v1");
      find_line(&file.lines, "+", "v2");
      assert!(find_diff(&diffs, "other.txt").is_new);

      let reversed = git_ref_diff(fixture.path(), "HEAD".to_string(), "HEAD~1".to_string())
         .expect("reversed ref diff");
      assert!(find_diff(&reversed, "other.txt").is_deleted);
   }

   #[test]
   fn ref_diff_reports_unknown_refs() {
      let fixture = Fixture::new();
      fixture.write("file.txt", "v1\n");
      fixture.commit_all("first");

      let base = git_ref_diff(fixture.path(), "nope".to_string(), "HEAD".to_string())
         .err()
         .expect("base error");
      assert!(base.starts_with("Failed to find base ref 'nope'"), "{base}");

      let target = git_ref_diff(fixture.path(), "HEAD".to_string(), "nope".to_string())
         .err()
         .expect("target error");
      assert!(
         target.starts_with("Failed to find target ref 'nope'"),
         "{target}"
      );
   }

   #[test]
   fn file_at_commit_reports_missing_files_bad_refs_and_non_utf8_content() {
      let fixture = Fixture::new();
      fixture.write("text.txt", "hello\n");
      fixture.write("latin1.txt", [0x63_u8, 0x61, 0x66, 0xe9]);
      fixture.commit_all("initial");

      assert_eq!(
         git_file_at_commit(fixture.path(), "HEAD".to_string(), "text.txt".to_string()),
         Ok("hello\n".to_string())
      );

      let missing = git_file_at_commit(fixture.path(), "HEAD".to_string(), "nope.txt".to_string())
         .expect_err("missing file");
      assert!(missing.starts_with("File not found at HEAD"), "{missing}");

      let bad_ref = git_file_at_commit(fixture.path(), "nope".to_string(), "text.txt".to_string())
         .expect_err("bad ref");
      assert!(bad_ref.starts_with("Commit not found"), "{bad_ref}");

      let non_utf8 =
         git_file_at_commit(fixture.path(), "HEAD".to_string(), "latin1.txt".to_string())
            .expect_err("non utf8");
      assert_eq!(non_utf8, "File is not valid UTF-8 at HEAD: latin1.txt");
   }

   #[cfg(unix)]
   #[test]
   fn unstaged_diff_for_a_path_that_is_not_a_literal_pathspec_still_has_lines() {
      let fixture = Fixture::new();
      fixture.write("back\\slash.txt", "a\nb\n");
      fixture.commit_all("initial");
      fixture.write("back\\slash.txt", "a\nc\n");

      let diff = fixture.diff("back\\slash.txt", false);

      assert_eq!(diff.file_path, "back\\slash.txt");
      assert!(!diff.is_new && !diff.is_deleted);
      assert_eq!((diff.additions, diff.deletions), (Some(1), Some(1)));
      find_line(&diff.lines, "-", "b");
      find_line(&diff.lines, "+", "c");
   }

   #[cfg(unix)]
   #[test]
   fn staged_diff_for_a_path_that_is_not_a_literal_pathspec_still_has_lines() {
      let fixture = Fixture::new();
      fixture.write("back\\slash.txt", "a\nb\n");
      fixture.commit_all("initial");
      fixture.remove("back\\slash.txt");
      fixture.stage_removal("back\\slash.txt");

      let diff = fixture.diff("back\\slash.txt", true);

      assert!(diff.is_deleted);
      assert_eq!((diff.additions, diff.deletions), (Some(0), Some(2)));
      find_line(&diff.lines, "-", "b");
   }

   #[cfg(unix)]
   #[test]
   fn image_diffs_for_paths_that_are_not_literal_pathspecs_return_blobs() {
      let fixture = Fixture::new();
      fixture.write("edited\\pic.png", PNG_V1);
      fixture.write("removed\\pic.png", PNG_V1);
      fixture.commit_all("initial");
      fixture.write("edited\\pic.png", PNG_V2);
      fixture.remove("removed\\pic.png");

      let unstaged = fixture.diff("edited\\pic.png", false);
      assert!(unstaged.is_image && unstaged.lines.is_empty());
      assert_eq!(unstaged.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(unstaged.new_blob_base64, Some(encode(PNG_V2)));

      fixture.stage("edited\\pic.png");
      fixture.stage_removal("removed\\pic.png");
      let staged = fixture.diff("edited\\pic.png", true);
      assert_eq!(staged.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(staged.new_blob_base64, Some(encode(PNG_V2)));

      let deleted = fixture.diff("removed\\pic.png", true);
      assert!(deleted.is_deleted);
      assert_eq!(deleted.old_blob_base64, Some(encode(PNG_V1)));
      assert_eq!(deleted.new_blob_base64, None);
   }

   #[test]
   fn untracked_files_are_not_diffed_or_counted() {
      let fixture = Fixture::new();
      fixture.write("tracked.txt", "t\n");
      fixture.commit_all("initial");
      fixture.write("untracked.txt", "u\n");

      let error = git_diff_file(fixture.path(), "untracked.txt".to_string(), false)
         .err()
         .expect("untracked file has no index diff");
      assert!(
         error.starts_with("No changes found for file: untracked.txt"),
         "{error}"
      );
      assert!(
         git_status_diff_stats(fixture.path())
            .expect("stats")
            .is_empty()
      );
   }

   #[test]
   fn binary_sniffing_handles_missing_and_text_files() {
      let dir = tempfile::tempdir().expect("temp dir");
      let text = dir.path().join("text.txt");
      let binary = dir.path().join("binary.dat");
      fs::write(&text, "no nulls here").expect("write text");
      fs::write(&binary, b"abc\0def").expect("write binary");

      assert!(!path_looks_binary(dir.path().join("missing")));
      assert!(!path_looks_binary(text));
      assert!(path_looks_binary(binary));
   }

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
