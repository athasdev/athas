use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
   fs,
   io::{Read, Write},
   path::{Component, Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 256 * 1024;
/// Search skips files larger than this; they are almost never hand-written source.
const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
/// A walk stops after this many files, so a huge tree cannot stall the agent.
const MAX_WALKED_FILES: usize = 100_000;
const MAX_SEARCH_BYTES: u64 = 256 * 1024 * 1024;
const DEFAULT_LIST_LIMIT: usize = 500;
const MAX_LIST_LIMIT: usize = 2000;
const DEFAULT_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_MATCHES_PER_FILE: usize = 50;
const MAX_CONTEXT_LINES: usize = 5;
const MAX_LINE_CHARS: usize = 300;
const MAX_EDITS: usize = 64;

fn excluded_path(relative: &Path) -> bool {
   relative.components().any(|part| {
      let name = part.as_os_str().to_string_lossy().to_ascii_lowercase();
      name == ".git"
         || name == ".env"
         || name.starts_with(".env.")
         || [".pem", ".key", ".p12", ".pfx"]
            .iter()
            .any(|extension| name.ends_with(extension))
   })
}

fn permitted_path(root: &str, relative: &str, create: bool) -> Result<PathBuf, String> {
   let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
   let relative = Path::new(relative);
   if relative.is_absolute()
      || relative
         .components()
         .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
   {
      return Err("Use a relative path inside the workspace.".into());
   }
   if excluded_path(relative) {
      return Err("This file is excluded from automatic workspace tools.".into());
   }
   let target = root.join(relative);
   let mut component_path = root.clone();
   for component in relative.components() {
      component_path.push(component);
      if fs::symlink_metadata(&component_path)
         .is_ok_and(|metadata| metadata.file_type().is_symlink())
      {
         return Err("Use the original workspace path instead of a symbolic link.".into());
      }
   }
   let resolved = match fs::canonicalize(&target) {
      Ok(path) => path,
      Err(error) if create && error.kind() == std::io::ErrorKind::NotFound => {
         // New files may sit in folders that do not exist yet: resolve the nearest existing
         // ancestor and append the rest, which the symlink check above already walked.
         let mut existing = target.parent().ok_or("A file path is required.")?;
         let mut missing = vec![target.file_name().ok_or("A file name is required.")?];
         while !existing.exists() {
            missing.push(existing.file_name().ok_or("A file path is required.")?);
            existing = existing.parent().ok_or("A file path is required.")?;
         }
         let mut resolved = fs::canonicalize(existing).map_err(|e| e.to_string())?;
         for part in missing.iter().rev() {
            resolved.push(part);
         }
         resolved
      }
      Err(error) => return Err(error.to_string()),
   };
   if !resolved.starts_with(&root) || resolved == root {
      return Err("The path must remain inside the workspace.".into());
   }
   if excluded_path(resolved.strip_prefix(&root).map_err(|e| e.to_string())?) {
      return Err("This file is excluded from automatic workspace tools.".into());
   }
   Ok(resolved)
}

pub fn read_workspace_file(root: &str, path: &str) -> Result<String, String> {
   let target = permitted_path(root, path, false)?;
   let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
   if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
      return Err("Read a text file smaller than 256 KiB.".into());
   }
   let mut content = String::new();
   fs::File::open(target)
      .map_err(|e| e.to_string())?
      .take(MAX_FILE_BYTES + 1)
      .read_to_string(&mut content)
      .map_err(|e| e.to_string())?;
   if content.len() as u64 > MAX_FILE_BYTES {
      return Err("Read a text file smaller than 256 KiB.".into());
   }
   Ok(content)
}

/// One exact replacement of an agent edit. `old_text` must match exactly one location unless
/// `replace_all` is set.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReplacement {
   pub old_text: String,
   pub new_text: String,
   #[serde(default)]
   pub replace_all: bool,
}

/// A write that landed: what the file held before (`None` when the write created it) and what it
/// holds now, so the change can be offered for review.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileWrite {
   /// The file's path as the workspace root spells it, the way open editors know it.
   pub path: String,
   pub previous_content: Option<String>,
   pub content: String,
}

fn current_content(root: &str, path: &str, target: &Path) -> Result<Option<String>, String> {
   match read_workspace_file(root, path) {
      Ok(content) => Ok(Some(content)),
      Err(_) if !target.exists() => Ok(None),
      Err(error) => Err(error),
   }
}

fn display_path(root: &str, relative: &str) -> String {
   let relative = Path::new(relative)
      .components()
      .filter(|part| matches!(part, Component::Normal(_)))
      .collect::<PathBuf>();
   Path::new(root.trim_end_matches(['/', '\\']))
      .join(relative)
      .to_string_lossy()
      .into_owned()
}

fn persist(target: &Path, content: &str) -> Result<(), String> {
   if content.len() as u64 > MAX_FILE_BYTES {
      return Err("The edited file would be larger than 256 KiB.".into());
   }
   let parent = target.parent().ok_or("Missing parent")?;
   fs::create_dir_all(parent).map_err(|e| e.to_string())?;
   let mut builder = tempfile::Builder::new();
   // A temporary file is private (0600); a file the agent creates should get the same mode as
   // any other new file, 0666 less the umask, like an editor save would give it.
   #[cfg(unix)]
   if !target.exists() {
      use std::os::unix::fs::PermissionsExt;
      builder.permissions(fs::Permissions::from_mode(0o666));
   }
   let mut temporary = builder.tempfile_in(parent).map_err(|e| e.to_string())?;
   if let Ok(metadata) = fs::metadata(target) {
      temporary
         .as_file()
         .set_permissions(metadata.permissions())
         .map_err(|e| e.to_string())?;
   }
   temporary
      .write_all(content.as_bytes())
      .map_err(|e| e.to_string())?;
   temporary.as_file().sync_all().map_err(|e| e.to_string())?;
   temporary.persist(target).map_err(|e| e.to_string())?;
   Ok(())
}

const CHANGED_SINCE_READ: &str =
   "The file changed since it was read. Read it again before editing.";

/// Applies `edits` in order to the version of the file the agent read, all or nothing.
pub fn edit_workspace_file(
   root: &str,
   path: &str,
   expected_content: &str,
   edits: &[WorkspaceReplacement],
) -> Result<WorkspaceFileWrite, String> {
   if edits.is_empty() || edits.len() > MAX_EDITS {
      return Err(format!("Send between 1 and {MAX_EDITS} edits."));
   }
   let target = permitted_path(root, path, false)?;
   let current = current_content(root, path, &target)?
      .ok_or("The file does not exist. Use write_file to create it.")?;
   if current != expected_content {
      return Err(CHANGED_SINCE_READ.into());
   }
   let mut content = current.clone();
   for (index, edit) in edits.iter().enumerate() {
      let number = index + 1;
      if edit.old_text.is_empty() {
         return Err(format!("Edit {number}: oldText must not be empty."));
      }
      let count = content.matches(edit.old_text.as_str()).count();
      if count == 0 {
         return Err(format!(
            "Edit {number}: oldText was not found. Earlier edits in the same call apply first; no \
             edit was applied."
         ));
      }
      if count > 1 && !edit.replace_all {
         return Err(format!(
            "Edit {number}: oldText matches {count} locations. Include more surrounding lines or \
             set replaceAll; no edit was applied."
         ));
      }
      content = if edit.replace_all {
         content.replace(edit.old_text.as_str(), &edit.new_text)
      } else {
         content.replacen(edit.old_text.as_str(), &edit.new_text, 1)
      };
   }
   if content == current {
      return Err("The edits leave the file unchanged.".into());
   }
   persist(&target, &content)?;
   Ok(WorkspaceFileWrite {
      path: display_path(root, path),
      previous_content: Some(current),
      content,
   })
}

/// Creates a file, or replaces all of one the agent read. `expected_content` is `None` when the
/// file must not exist yet.
pub fn write_workspace_file(
   root: &str,
   path: &str,
   expected_content: Option<&str>,
   content: &str,
) -> Result<WorkspaceFileWrite, String> {
   let target = permitted_path(root, path, true)?;
   let current = current_content(root, path, &target)?;
   if current.as_deref() != expected_content {
      return Err(if expected_content.is_none() {
         "The file already exists. Read it first, then edit or overwrite it.".into()
      } else {
         CHANGED_SINCE_READ.into()
      });
   }
   persist(&target, content)?;
   Ok(WorkspaceFileWrite {
      path: display_path(root, path),
      previous_content: current,
      content: content.to_string(),
   })
}

/// Deletes a file the agent read, if it still holds what was read. Returns the display path.
pub fn delete_workspace_file(
   root: &str,
   path: &str,
   expected_content: &str,
) -> Result<String, String> {
   let target = permitted_path(root, path, false)?;
   if !fs::metadata(&target).is_ok_and(|metadata| metadata.is_file()) {
      return Err("Only files can be deleted.".into());
   }
   if read_workspace_file(root, path)? != expected_content {
      return Err(CHANGED_SINCE_READ.into());
   }
   fs::remove_file(&target).map_err(|e| e.to_string())?;
   Ok(display_path(root, path))
}

fn glob_matcher(glob: Option<&str>) -> Result<Option<(globset::GlobMatcher, bool)>, String> {
   let Some(glob) = glob.map(str::trim).filter(|glob| !glob.is_empty()) else {
      return Ok(None);
   };
   let matcher = globset::GlobBuilder::new(glob)
      .literal_separator(true)
      .build()
      .map_err(|e| format!("Invalid glob: {e}"))?
      .compile_matcher();
   // A glob without a slash, like `*.ts`, matches file names in every folder.
   Ok(Some((matcher, !glob.contains('/'))))
}

struct WorkspaceWalk {
   files: Vec<(PathBuf, String)>,
   truncated: bool,
}

/// The workspace files under `subpath` that `.gitignore` does not exclude, in path order,
/// leaving out `.git`, `node_modules`, symbolic links, and credentials.
fn walk_workspace(
   root: &str,
   subpath: Option<&str>,
   glob: Option<&str>,
) -> Result<WorkspaceWalk, String> {
   let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
   let start = match subpath
      .map(str::trim)
      .filter(|p| !p.is_empty() && *p != ".")
   {
      Some(subpath) => {
         let relative = Path::new(subpath);
         if relative.is_absolute()
            || relative
               .components()
               .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
         {
            return Err("Use a relative path inside the workspace.".into());
         }
         let start = fs::canonicalize(canonical_root.join(relative))
            .map_err(|_| format!("{subpath} does not exist in the workspace."))?;
         if !start.starts_with(&canonical_root) {
            return Err("The path must remain inside the workspace.".into());
         }
         start
      }
      None => canonical_root.clone(),
   };
   let matcher = glob_matcher(glob)?;
   let walker = ignore::WalkBuilder::new(&start)
      .hidden(false)
      .git_ignore(true)
      .git_global(true)
      .git_exclude(true)
      .require_git(false)
      .parents(true)
      .follow_links(false)
      .sort_by_file_name(|a, b| a.cmp(b))
      .filter_entry(|entry| {
         let name = entry.file_name();
         name != ".git" && name != "node_modules"
      })
      .build();
   let mut files = Vec::new();
   let mut truncated = false;
   for entry in walker.filter_map(Result::ok) {
      if !entry.file_type().is_some_and(|kind| kind.is_file()) {
         continue;
      }
      let Ok(relative) = entry.path().strip_prefix(&canonical_root) else {
         continue;
      };
      if excluded_path(relative) {
         continue;
      }
      if let Some((matcher, name_only)) = &matcher {
         let candidate = if *name_only {
            relative.file_name().map(Path::new).unwrap_or(relative)
         } else {
            relative
         };
         if !matcher.is_match(candidate) {
            continue;
         }
      }
      if files.len() >= MAX_WALKED_FILES {
         truncated = true;
         break;
      }
      let relative = relative.to_string_lossy().replace('\\', "/");
      files.push((entry.into_path(), relative));
   }
   Ok(WorkspaceWalk { files, truncated })
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesOptions {
   /// A folder to list, relative to the workspace.
   pub path: Option<String>,
   pub glob: Option<String>,
   pub offset: Option<usize>,
   pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileList {
   pub files: Vec<String>,
   /// Files matched in total, of which `files` is one page.
   pub total: usize,
   /// Pass as `offset` for the next page; absent on the last page.
   pub next_offset: Option<usize>,
   /// The walk stopped early, so `total` is a lower bound.
   pub truncated: bool,
}

pub fn list_workspace_files(
   root: &str,
   options: &ListFilesOptions,
) -> Result<WorkspaceFileList, String> {
   let walk = walk_workspace(root, options.path.as_deref(), options.glob.as_deref())?;
   let limit = options
      .limit
      .unwrap_or(DEFAULT_LIST_LIMIT)
      .clamp(1, MAX_LIST_LIMIT);
   let offset = options.offset.unwrap_or(0);
   let total = walk.files.len();
   let files = walk
      .files
      .into_iter()
      .skip(offset)
      .take(limit)
      .map(|(_, relative)| relative)
      .collect::<Vec<_>>();
   let end = offset.saturating_add(files.len());
   Ok(WorkspaceFileList {
      files,
      total,
      next_offset: (end < total).then_some(end),
      truncated: walk.truncated,
   })
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
   pub query: String,
   /// Treat `query` as a regular expression instead of literal text.
   #[serde(default)]
   pub regex: bool,
   /// Unset means smart case: case-insensitive unless the query has an uppercase letter.
   pub case_sensitive: Option<bool>,
   pub path: Option<String>,
   pub glob: Option<String>,
   pub context_lines: Option<usize>,
   pub max_results: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMatch {
   pub path: String,
   pub line: usize,
   pub text: String,
   #[serde(skip_serializing_if = "Vec::is_empty")]
   pub before: Vec<String>,
   #[serde(skip_serializing_if = "Vec::is_empty")]
   pub after: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
   pub matches: Vec<WorkspaceMatch>,
   /// Some matches were left out: the result cap, a per-file cap, or the walk limit was hit.
   pub truncated: bool,
   pub files_searched: usize,
}

fn search_pattern(options: &SearchOptions) -> Result<Regex, String> {
   let query = options.query.as_str();
   if query.is_empty() || query.len() > 500 {
      return Err("Search for 1 to 500 bytes of text.".into());
   }
   let source = if options.regex {
      query.to_string()
   } else {
      regex::escape(query)
   };
   let case_sensitive = options
      .case_sensitive
      .unwrap_or_else(|| query.chars().any(char::is_uppercase));
   RegexBuilder::new(&source)
      .case_insensitive(!case_sensitive)
      .size_limit(1 << 20)
      .build()
      .map_err(|e| format!("Invalid regular expression: {e}"))
}

fn clip(line: &str) -> String {
   line.chars().take(MAX_LINE_CHARS).collect()
}

/// Searches the workspace line by line, the way `rg` does: `.gitignore` is respected and binary
/// or very large files are skipped.
pub fn search_workspace_files(
   root: &str,
   options: &SearchOptions,
) -> Result<WorkspaceSearchResult, String> {
   let pattern = search_pattern(options)?;
   let context = options.context_lines.unwrap_or(0).min(MAX_CONTEXT_LINES);
   let max_results = options
      .max_results
      .unwrap_or(DEFAULT_SEARCH_RESULTS)
      .clamp(1, MAX_SEARCH_RESULTS);
   let walk = walk_workspace(root, options.path.as_deref(), options.glob.as_deref())?;
   let mut truncated = walk.truncated;
   let mut matches = Vec::new();
   let mut files_searched = 0;
   let mut bytes_read = 0_u64;
   for (absolute, relative) in walk.files {
      let Ok(metadata) = fs::metadata(&absolute) else {
         continue;
      };
      if metadata.len() > MAX_SEARCH_FILE_BYTES {
         continue;
      }
      bytes_read += metadata.len();
      if bytes_read > MAX_SEARCH_BYTES {
         truncated = true;
         break;
      }
      let Ok(bytes) = fs::read(&absolute) else {
         continue;
      };
      if bytes.iter().take(8192).any(|byte| *byte == 0) {
         continue;
      }
      let Ok(content) = String::from_utf8(bytes) else {
         continue;
      };
      files_searched += 1;
      let lines = content.lines().collect::<Vec<_>>();
      let mut in_file = 0;
      for (index, line) in lines.iter().enumerate() {
         if !pattern.is_match(line) {
            continue;
         }
         if matches.len() >= max_results {
            return Ok(WorkspaceSearchResult {
               matches,
               truncated: true,
               files_searched,
            });
         }
         if in_file >= MAX_MATCHES_PER_FILE {
            truncated = true;
            break;
         }
         in_file += 1;
         matches.push(WorkspaceMatch {
            path: relative.clone(),
            line: index + 1,
            text: clip(line),
            before: lines[index.saturating_sub(context)..index]
               .iter()
               .map(|line| clip(line))
               .collect(),
            after: lines[index + 1..(index + 1 + context).min(lines.len())]
               .iter()
               .map(|line| clip(line))
               .collect(),
         });
      }
   }
   Ok(WorkspaceSearchResult {
      matches,
      truncated,
      files_searched,
   })
}

#[cfg(test)]
mod tests {
   use super::*;
   #[cfg(unix)]
   #[test]
   fn creates_files_with_the_usual_mode() {
      use std::os::unix::fs::PermissionsExt;
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join("plain.txt"), "x").unwrap();
      write_workspace_file(root, "created.txt", None, "x").unwrap();
      let mode = |name: &str| {
         fs::metadata(dir.path().join(name))
            .unwrap()
            .permissions()
            .mode()
            & 0o777
      };
      assert_eq!(mode("created.txt"), mode("plain.txt"));
   }
   #[test]
   fn refuses_traversal_and_secret_files() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join(".env"), "secret").unwrap();
      assert!(read_workspace_file(root, "../outside").is_err());
      assert!(read_workspace_file(root, ".env").is_err());
      assert!(read_workspace_file(root, "/etc/passwd").is_err());
   }
   fn replace(old_text: &str, new_text: &str) -> WorkspaceReplacement {
      WorkspaceReplacement {
         old_text: old_text.into(),
         new_text: new_text.into(),
         replace_all: false,
      }
   }
   #[test]
   fn edits_only_the_read_version_and_preserves_unrelated_content() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join("code.ts"), "before old after").unwrap();
      assert!(edit_workspace_file(root, "code.ts", "stale", &[replace("old", "new")]).is_err());
      let write = edit_workspace_file(
         root,
         "code.ts",
         "before old after",
         &[replace("old", "new")],
      )
      .unwrap();
      assert_eq!(write.previous_content.as_deref(), Some("before old after"));
      assert_eq!(write.content, "before new after");
      assert_eq!(write.path, dir.path().join("code.ts").to_string_lossy());
      assert_eq!(
         read_workspace_file(root, "code.ts").unwrap(),
         "before new after"
      );
      let created = write_workspace_file(root, "nested/dir/new.ts", None, "created").unwrap();
      assert_eq!(created.previous_content, None);
      assert_eq!(
         read_workspace_file(root, "nested/dir/new.ts").unwrap(),
         "created"
      );
      assert!(write_workspace_file(root, "nested/dir/new.ts", None, "again").is_err());
      write_workspace_file(root, "nested/dir/new.ts", Some("created"), "replaced").unwrap();
      assert_eq!(
         read_workspace_file(root, "nested/dir/new.ts").unwrap(),
         "replaced"
      );
   }
   #[test]
   fn applies_multiple_edits_atomically() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      let original = "a = 1\nb = 2\nc = 1\n";
      fs::write(dir.path().join("code.py"), original).unwrap();
      let failed = edit_workspace_file(
         root,
         "code.py",
         original,
         &[replace("a = 1", "a = 10"), replace("missing", "x")],
      );
      assert!(failed.unwrap_err().starts_with("Edit 2"));
      assert_eq!(read_workspace_file(root, "code.py").unwrap(), original);
      assert!(
         edit_workspace_file(root, "code.py", original, &[replace("= 1", "= 3")])
            .unwrap_err()
            .contains("2 locations")
      );
      let write = edit_workspace_file(
         root,
         "code.py",
         original,
         &[
            replace("b = 2", "b = 20"),
            WorkspaceReplacement {
               old_text: "= 1\n".into(),
               new_text: "= 5\n".into(),
               replace_all: true,
            },
         ],
      )
      .unwrap();
      assert_eq!(write.content, "a = 5\nb = 20\nc = 5\n");
   }
   #[test]
   fn deletes_only_the_read_version() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join("old.ts"), "content").unwrap();
      assert!(delete_workspace_file(root, "old.ts", "stale").is_err());
      assert!(dir.path().join("old.ts").exists());
      delete_workspace_file(root, "old.ts", "content").unwrap();
      assert!(!dir.path().join("old.ts").exists());
   }
   #[test]
   fn lists_and_searches_respecting_gitignore_with_pages_and_context() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
      fs::create_dir_all(dir.path().join("ignored")).unwrap();
      fs::create_dir_all(dir.path().join("src/deep")).unwrap();
      fs::write(dir.path().join("ignored/hit.ts"), "needle").unwrap();
      fs::write(dir.path().join(".env"), "needle").unwrap();
      fs::write(dir.path().join("src/a.ts"), "one\nNeedle two\nthree\n").unwrap();
      fs::write(dir.path().join("src/deep/b.rs"), "fn needle_fn() {}\n").unwrap();
      fs::write(dir.path().join("src/bin.dat"), b"needle\0binary").unwrap();

      let all = list_workspace_files(root, &ListFilesOptions::default()).unwrap();
      assert_eq!(
         all.files,
         vec![".gitignore", "src/a.ts", "src/bin.dat", "src/deep/b.rs"]
      );
      let page = list_workspace_files(
         root,
         &ListFilesOptions {
            limit: Some(2),
            offset: Some(1),
            ..Default::default()
         },
      )
      .unwrap();
      assert_eq!(page.files, vec!["src/a.ts", "src/bin.dat"]);
      assert_eq!(page.next_offset, Some(3));
      assert_eq!(page.total, 4);
      let rust = list_workspace_files(
         root,
         &ListFilesOptions {
            glob: Some("*.rs".into()),
            ..Default::default()
         },
      )
      .unwrap();
      assert_eq!(rust.files, vec!["src/deep/b.rs"]);

      let found = search_workspace_files(
         root,
         &SearchOptions {
            query: "needle".into(),
            context_lines: Some(1),
            ..Default::default()
         },
      )
      .unwrap();
      let hits = found
         .matches
         .iter()
         .map(|hit| (hit.path.as_str(), hit.line))
         .collect::<Vec<_>>();
      assert_eq!(hits, vec![("src/a.ts", 2), ("src/deep/b.rs", 1)]);
      assert_eq!(found.matches[0].before, vec!["one"]);
      assert_eq!(found.matches[0].after, vec!["three"]);

      let exact = search_workspace_files(
         root,
         &SearchOptions {
            query: r"fn \w+\(".into(),
            regex: true,
            path: Some("src".into()),
            ..Default::default()
         },
      )
      .unwrap();
      assert_eq!(exact.matches.len(), 1);
      assert_eq!(exact.matches[0].path, "src/deep/b.rs");
      let capped = search_workspace_files(
         root,
         &SearchOptions {
            query: "needle".into(),
            max_results: Some(1),
            ..Default::default()
         },
      )
      .unwrap();
      assert_eq!(capped.matches.len(), 1);
      assert!(capped.truncated);
      assert!(
         search_workspace_files(
            root,
            &SearchOptions {
               query: "(".into(),
               regex: true,
               ..Default::default()
            }
         )
         .is_err()
      );
   }
   #[cfg(unix)]
   #[test]
   fn refuses_symlink_escape() {
      let dir = tempfile::tempdir().unwrap();
      let outside = tempfile::tempdir().unwrap();
      fs::write(outside.path().join("secret"), "private").unwrap();
      std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
      let root = dir.path().to_str().unwrap();
      assert!(read_workspace_file(root, "linked/secret").is_err());
      fs::write(dir.path().join(".env"), "secret").unwrap();
      std::os::unix::fs::symlink(dir.path().join(".env"), dir.path().join("alias")).unwrap();
      assert!(read_workspace_file(root, "alias").is_err());
      assert!(write_workspace_file(root, "linked/new", None, "content").is_err());
   }
}
