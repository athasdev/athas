//! Content search over the project index (`athas-fff-search`), read one page at a time so the
//! view can show results while the rest of the project is still being searched.

use std::{path::PathBuf, sync::Arc};

use anyhow::{Result, anyhow};
use gpui::{App, Global};
#[cfg(not(target_family = "wasm"))]
use gpui::AppContext as _;

use crate::query::{GrepPattern, PathFilter};

#[cfg(not(target_family = "wasm"))]
use {
    athas_fff_search::{FffGrepOptions, GrepMode},
    std::time::{Duration, Instant},
};

#[cfg(not(target_family = "wasm"))]
pub use athas_fff_search::FffSearch as Index;

/// The web build has no project index; searches report that instead.
#[cfg(target_family = "wasm")]
pub struct Index;

#[cfg(target_family = "wasm")]
impl Index {
    fn without_frecency(_: bool) -> Self {
        Index
    }
}

/// Matches asked of the index per page.
#[cfg(not(target_family = "wasm"))]
const PAGE_MATCHES: usize = 200;
/// Time one page may spend before it returns what it has.
#[cfg(not(target_family = "wasm"))]
const PAGE_TIME_BUDGET_MS: u64 = 120;
/// How long a search waits for a first index of the project.
#[cfg(not(target_family = "wasm"))]
const INDEX_TIMEOUT: Duration = Duration::from_secs(60);

/// The project index, shared by every search view.
struct SearchIndex(Arc<Index>);

impl Global for SearchIndex {}

pub fn index(cx: &mut App) -> Arc<Index> {
    if let Some(index) = cx.try_global::<SearchIndex>() {
        return index.0.clone();
    }
    let index = Arc::new(Index::without_frecency(false));
    cx.set_global(SearchIndex(index.clone()));
    index
}

/// Brings the project index up to date with changes a watcher reported under `root`
/// (`apply_changes` in `file_events.rs`); the index never watches on its own.
pub fn index_files_changed(root: &std::path::Path, paths: &[PathBuf], rescan: bool, cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    if let Some(index) = cx.try_global::<SearchIndex>().map(|index| index.0.clone()) {
        let (root, paths) = (root.to_path_buf(), paths.to_vec());
        cx.background_spawn(async move {
            let inside_git = |path: &PathBuf| path.components().any(|part| part.as_os_str() == ".git");
            let git_changed = paths.iter().any(inside_git);
            let changes: Vec<athas_fff_search::FffFsChange> = paths
                .iter()
                .filter(|path| !inside_git(path))
                .map(|path| {
                    let metadata = std::fs::symlink_metadata(path).ok();
                    athas_fff_search::FffFsChange { path: path.clone(), removed: metadata.is_none(), is_dir: metadata.is_some_and(|metadata| metadata.is_dir()) }
                })
                .collect();
            index.apply_changes(&root, &changes, rescan, git_changed).ok();
        })
        .detach();
    }
    #[cfg(target_family = "wasm")]
    let _ = (root, paths, rescan, cx);
}

/// How the web build searches: on the workspace server, the whole result in one page.
#[cfg(target_family = "wasm")]
pub type WebGrep = Arc<dyn Fn(&[PathBuf], &GrepPattern, &PathFilter) -> Result<Page> + Send + Sync>;

#[cfg(target_family = "wasm")]
static WEB_GREP: std::sync::OnceLock<WebGrep> = std::sync::OnceLock::new();

#[cfg(target_family = "wasm")]
pub fn set_web_grep(grep: WebGrep) {
    let _ = WEB_GREP.set(grep);
}

#[cfg(target_family = "wasm")]
pub fn prepare(_: &Index, _: &[PathBuf]) -> Result<()> {
    WEB_GREP.get().map(|_| ()).ok_or_else(|| anyhow!("Project search needs a workspace server"))
}

#[cfg(target_family = "wasm")]
pub fn grep_page(_: &Index, roots: &[PathBuf], pattern: &GrepPattern, filter: &PathFilter, offset: usize) -> Result<Page> {
    let grep = WEB_GREP.get().ok_or_else(|| anyhow!("Project search needs a workspace server"))?;
    if offset > 0 {
        return Ok(Page::default());
    }
    grep(roots, pattern, filter)
}

/// Indexes the roots (once) and waits for the scan to finish.
#[cfg(not(target_family = "wasm"))]
pub fn prepare(index: &Index, roots: &[PathBuf]) -> Result<()> {
    let local: Vec<&PathBuf> = roots.iter().filter(|root| !crate::remote::is_remote(root)).collect();
    if local.is_empty() {
        return Ok(());
    }
    let paths = || local.iter().map(|root| root.as_path());
    index.ensure_workspaces(paths())?;
    let started = Instant::now();
    while !index.wait_for_scan(paths(), Duration::from_millis(250))? {
        if started.elapsed() > INDEX_TIMEOUT {
            return Err(anyhow!("Indexing the project is taking too long"));
        }
    }
    Ok(())
}

/// One matched line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineMatch {
    /// 1-based.
    pub line: u32,
    /// Byte offset of the first match in the line.
    pub column: usize,
    pub text: String,
    /// Byte ranges of the matches in `text`.
    pub ranges: Vec<(u32, u32)>,
}

/// A file's matches, in line order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileMatches {
    pub path: PathBuf,
    /// Relative to its project root, with `/` separators.
    pub relative: String,
    pub matches: Vec<LineMatch>,
}

impl FileMatches {
    pub fn match_count(&self) -> usize {
        self.matches.iter().map(|line| line.ranges.len().max(1)).sum()
    }
}

/// One page of a search.
#[derive(Debug, Default)]
pub struct Page {
    pub files: Vec<FileMatches>,
    /// Where the next page starts; 0 when the search is complete.
    pub next_offset: usize,
    pub searched_files: usize,
    pub searchable_files: usize,
    pub regex_error: Option<String>,
}

#[cfg(not(target_family = "wasm"))]
pub fn grep_page(
    index: &Index,
    roots: &[PathBuf],
    pattern: &GrepPattern,
    filter: &PathFilter,
    offset: usize,
) -> Result<Page> {
    let remote = if offset == 0 && roots.iter().any(|root| crate::remote::is_remote(root)) {
        crate::remote::grep(roots, pattern, filter)?
    } else {
        Vec::new()
    };
    let local: Vec<PathBuf> = roots.iter().filter(|root| !crate::remote::is_remote(root)).cloned().collect();
    if local.is_empty() {
        let searched = remote.len();
        return Ok(Page { files: remote, next_offset: 0, searched_files: searched, searchable_files: searched, regex_error: None });
    }
    let mut page = grep_local(index, &local, pattern, filter, offset)?;
    page.searched_files += remote.len();
    page.searchable_files += remote.len();
    page.files.extend(remote);
    Ok(page)
}

#[cfg(not(target_family = "wasm"))]
fn grep_local(index: &Index, roots: &[PathBuf], pattern: &GrepPattern, filter: &PathFilter, offset: usize) -> Result<Page> {
    let result = index.grep(
        roots.iter().map(PathBuf::as_path),
        &FffGrepOptions {
            pattern: pattern.pattern.clone(),
            mode: if pattern.is_regex { GrepMode::Regex } else { GrepMode::PlainText },
            file_offset: offset,
            page_limit: PAGE_MATCHES,
            time_budget_ms: PAGE_TIME_BUDGET_MS,
            before_context: 0,
            after_context: 0,
        },
    )?;
    if result.is_indexing {
        return Err(anyhow!("The project is still being indexed"));
    }
    if result.next_file_offset != 0 && result.next_file_offset <= offset {
        return Err(anyhow!("Search pagination did not advance. Search again."));
    }
    let mut files: Vec<FileMatches> = Vec::new();
    for found in result.matches {
        let path = PathBuf::from(&found.file_path);
        let relative = relative_path(&path, roots);
        if !filter.is_empty() && !filter.matches(&relative) {
            continue;
        }
        let line = LineMatch {
            line: found.line_number as u32,
            column: found.match_byte_offsets.first().map_or(found.column, |(start, _)| *start as usize),
            text: found.line_content,
            ranges: found.match_byte_offsets,
        };
        match files.last_mut() {
            Some(file) if file.path == path => file.matches.push(line),
            _ => files.push(FileMatches { path, relative, matches: vec![line] }),
        }
    }
    Ok(Page {
        files,
        next_offset: result.next_file_offset,
        searched_files: result.searched_files,
        searchable_files: result.searchable_files,
        regex_error: result.regex_fallback_error,
    })
}

/// Adds a page's files to the results, joining a file that continues from the previous page.
pub fn merge(results: &mut Vec<FileMatches>, page: Vec<FileMatches>) {
    for file in page {
        match results.iter_mut().find(|existing| existing.path == file.path) {
            Some(existing) => existing.matches.extend(file.matches),
            None => results.push(file),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
fn relative_path(path: &std::path::Path, roots: &[PathBuf]) -> String {
    roots
        .iter()
        .filter_map(|root| path.strip_prefix(root).ok())
        .min_by_key(|relative| relative.components().count())
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
    use std::{fs, path::Path};

    use super::*;
    use crate::query::{SearchOptions, grep_pattern};

    fn search(dir: &Path, query: &str, options: SearchOptions, filter: PathFilter) -> Vec<FileMatches> {
        let index = Index::without_frecency(false);
        let roots = vec![dir.to_path_buf()];
        prepare(&index, &roots).unwrap();
        let pattern = grep_pattern(query, options);
        let mut results = Vec::new();
        let mut offset = 0;
        loop {
            let page = grep_page(&index, &roots, &pattern, &filter, offset).unwrap();
            merge(&mut results, page.files);
            if page.next_offset == 0 {
                break;
            }
            offset = page.next_offset;
        }
        results.sort_by(|a, b| a.relative.cmp(&b.relative));
        results
    }

    #[test]
    fn finds_matches_grouped_by_file_with_filters() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/a.rs"), "let Needle = 1;\nneedle();\n").unwrap();
        fs::write(dir.path().join("b.md"), "a needle here\n").unwrap();
        fs::write(dir.path().join("c.txt"), "nothing\n").unwrap();

        let all = search(dir.path(), "needle", SearchOptions::default(), PathFilter::default());
        assert_eq!(all.iter().map(|file| file.relative.as_str()).collect::<Vec<_>>(), ["b.md", "src/a.rs"]);
        assert_eq!(all[1].matches.iter().map(|line| line.line).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(all[1].matches[0].ranges, [(4, 10)]);

        let sensitive = SearchOptions { case_sensitive: true, ..Default::default() };
        assert_eq!(search(dir.path(), "Needle", sensitive, PathFilter::default()).len(), 1);

        let rust_only = search(dir.path(), "needle", SearchOptions::default(), PathFilter::new("*.rs", ""));
        assert_eq!(rust_only.len(), 1);
        assert_eq!(rust_only[0].match_count(), 2);
    }
}
