use athas_fff_search::{FffGrepOptions, FffScanStatus, FffSearch};
use fff_search::GrepMode;
use std::{
   fs,
   path::{Path, PathBuf},
   sync::Mutex,
   time::Duration,
};
use tempfile::TempDir;

static TEST_LOCK: Mutex<()> = Mutex::new(());

fn create_search(watch: bool) -> FffSearch {
   FffSearch::without_frecency(watch)
}

fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
   TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner())
}

#[test]
fn indexes_and_searches_multiple_workspace_roots() {
   let _guard = lock_tests();
   let temp_dir = TempDir::new().unwrap();
   let first_root = temp_dir.path().join("first");
   let second_root = temp_dir.path().join("second");
   fs::create_dir_all(&first_root).unwrap();
   fs::create_dir_all(&second_root).unwrap();
   fs::write(
      first_root.join("alpha-command.ts"),
      "export const alpha = true;",
   )
   .unwrap();
   fs::write(
      second_root.join("beta-panel.tsx"),
      "export function Beta() {}",
   )
   .unwrap();
   fs::write(second_root.join("ignored.log"), "ignored").unwrap();
   fs::write(second_root.join(".ignore"), "*.log\n").unwrap();

   let search = create_search(false);
   let roots = [first_root.as_path(), second_root.as_path()];
   search.ensure_workspaces(roots).unwrap();
   assert!(search.wait_for_scan(roots, Duration::from_secs(5)).unwrap());

   let files = search.list_files(roots).unwrap();
   assert!(files.iter().any(|file| file.name == "alpha-command.ts"));
   assert!(files.iter().any(|file| file.name == "beta-panel.tsx"));
   assert!(!files.iter().any(|file| file.name == "ignored.log"));

   let hits = search.search(roots, "beta panel", 20).unwrap();
   assert_eq!(
      hits.first().map(|hit| hit.name.as_str()),
      Some("beta-panel.tsx")
   );
   assert_eq!(search.indexed_workspace_count().unwrap(), 2);

   search.ensure_workspaces(roots).unwrap();
   assert_eq!(search.indexed_workspace_count().unwrap(), 2);
}

#[test]
fn paginates_content_search_across_workspace_roots() {
   let _guard = lock_tests();
   let temp_dir = TempDir::new().unwrap();
   let first_root = temp_dir.path().join("first");
   let second_root = temp_dir.path().join("second");
   fs::create_dir_all(&first_root).unwrap();
   fs::create_dir_all(&second_root).unwrap();
   fs::write(first_root.join("a.txt"), "needle in first root\n").unwrap();
   fs::write(second_root.join("b.txt"), "needle in second root\n").unwrap();

   let search = create_search(false);
   let roots = [first_root.as_path(), second_root.as_path()];
   search.ensure_workspaces(roots).unwrap();
   assert!(search.wait_for_scan(roots, Duration::from_secs(5)).unwrap());

   let first_page = search
      .grep(
         roots,
         &FffGrepOptions {
            pattern: "needle".to_string(),
            mode: GrepMode::PlainText,
            file_offset: 0,
            page_limit: 1,
            time_budget_ms: 0,
            before_context: 0,
            after_context: 0,
         },
      )
      .unwrap();
   assert_eq!(first_page.matches.len(), 1);
   assert!(first_page.next_file_offset > 0);
   assert_eq!(first_page.searchable_files, 2);

   let second_page = search
      .grep(
         roots,
         &FffGrepOptions {
            pattern: "needle".to_string(),
            mode: GrepMode::PlainText,
            file_offset: first_page.next_file_offset,
            page_limit: 1,
            time_budget_ms: 0,
            before_context: 0,
            after_context: 0,
         },
      )
      .unwrap();
   assert_eq!(second_page.matches.len(), 1);
   assert_eq!(second_page.next_file_offset, 0);
   assert_ne!(
      first_page.matches[0].file_path,
      second_page.matches[0].file_path
   );
}

fn grep_options(pattern: &str, mode: GrepMode) -> FffGrepOptions {
   FffGrepOptions {
      pattern: pattern.to_string(),
      mode,
      file_offset: 0,
      page_limit: 100,
      time_budget_ms: 0,
      before_context: 0,
      after_context: 0,
   }
}

fn scanned_root(files: &[(&str, &str)]) -> (TempDir, PathBuf, FffSearch) {
   let temp_dir = TempDir::new().unwrap();
   let root = temp_dir.path().join("root");
   for (relative, contents) in files {
      let path = root.join(relative);
      fs::create_dir_all(path.parent().unwrap()).unwrap();
      fs::write(path, contents).unwrap();
   }
   let search = create_search(false);
   search.ensure_workspaces([root.as_path()]).unwrap();
   assert!(
      search
         .wait_for_scan([root.as_path()], Duration::from_secs(5))
         .unwrap()
   );
   (temp_dir, root, search)
}

#[test]
fn blank_queries_return_nothing_without_indexing() {
   let _guard = lock_tests();
   let temp_dir = TempDir::new().unwrap();
   let search = create_search(false);

   assert!(
      search
         .search([temp_dir.path()], "   ", 10)
         .unwrap()
         .is_empty()
   );
   assert_eq!(search.indexed_workspace_count().unwrap(), 0);
   assert_eq!(
      search.scan_status(std::iter::empty()).unwrap(),
      FffScanStatus::default()
   );
}

#[test]
fn deduplicates_repeated_and_empty_roots() {
   let _guard = lock_tests();
   let (_temp_dir, root, search) = scanned_root(&[("one.rs", "fn one() {}"), ("two.rs", "")]);
   let roots = [root.as_path(), Path::new(""), root.as_path()];

   search.ensure_workspaces(roots).unwrap();
   assert_eq!(search.indexed_workspace_count().unwrap(), 1);

   let files = search.list_files(roots).unwrap();
   let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
   assert_eq!(names, vec!["one.rs", "two.rs"]);
   assert_eq!(files[0].relative_path, "one.rs");
   assert!(Path::new(&files[0].path).is_absolute());

   let status = search.scan_status(roots).unwrap();
   assert!(!status.is_scanning);
   assert_eq!(status.indexed_files, 2);
}

#[test]
fn search_truncates_to_the_limit_and_treats_zero_as_one() {
   let _guard = lock_tests();
   let (_temp_dir, root, search) = scanned_root(&[
      ("report-alpha.md", ""),
      ("report-beta.md", ""),
      ("report-gamma.md", ""),
   ]);
   let roots = [root.as_path()];

   let hits = search.search(roots, "report", 2).unwrap();
   assert_eq!(hits.len(), 2);
   assert!(hits.windows(2).all(|pair| pair[0].score >= pair[1].score));

   assert_eq!(search.search(roots, "report", 0).unwrap().len(), 1);

   let mut paths: Vec<_> = search
      .search(roots, "report", 10)
      .unwrap()
      .into_iter()
      .map(|hit| hit.path)
      .collect();
   assert_eq!(paths.len(), 3);
   paths.sort();
   paths.dedup();
   assert_eq!(paths.len(), 3);
}

#[test]
fn grep_reports_lines_columns_offsets_and_context() {
   let _guard = lock_tests();
   let (_temp_dir, root, search) = scanned_root(&[
      ("src/lib.rs", "first line\nlet needle = 1;\nlast line\n"),
      ("src/other.rs", "needle needle\n"),
      ("README.md", "nothing to see\n"),
   ]);

   let mut options = grep_options("needle", GrepMode::PlainText);
   options.before_context = 1;
   options.after_context = 1;
   let result = search.grep([root.as_path()], &options).unwrap();

   assert!(!result.is_indexing);
   assert_eq!(result.files_with_matches, 2);
   assert_eq!(result.next_file_offset, 0);
   assert_eq!(result.searchable_files, 3);

   let lib_match = result
      .matches
      .iter()
      .find(|grep_match| grep_match.file_path.ends_with("lib.rs"))
      .unwrap();
   assert_eq!(lib_match.line_number, 2);
   assert_eq!(lib_match.column, 4);
   assert_eq!(lib_match.line_content, "let needle = 1;");
   assert_eq!(lib_match.match_byte_offsets, vec![(4, 10)]);
   assert_eq!(lib_match.context_before, vec!["first line"]);
   assert_eq!(lib_match.context_after, vec!["last line"]);

   let other_match = result
      .matches
      .iter()
      .find(|grep_match| grep_match.file_path.ends_with("other.rs"))
      .unwrap();
   assert_eq!(other_match.match_byte_offsets, vec![(0, 6), (7, 13)]);
}

#[test]
fn grep_regex_mode_matches_patterns_and_reports_invalid_regexes() {
   let _guard = lock_tests();
   let (_temp_dir, root, search) =
      scanned_root(&[("a.txt", "version 12\nversion x\n"), ("b.txt", "nope\n")]);
   let roots = [root.as_path()];

   let result = search
      .grep(roots, &grep_options(r"version \d+", GrepMode::Regex))
      .unwrap();
   assert_eq!(result.matches.len(), 1);
   assert_eq!(result.matches[0].line_content, "version 12");
   assert!(result.regex_fallback_error.is_none());

   let invalid = search
      .grep(roots, &grep_options("version (", GrepMode::Regex))
      .unwrap();
   assert!(invalid.regex_fallback_error.is_some());
}

#[test]
fn frecency_database_directory_is_created_and_access_tracking_works() {
   let _guard = lock_tests();
   let temp_dir = TempDir::new().unwrap();
   let db_path = temp_dir.path().join("nested").join("frecency");
   let file = temp_dir.path().join("tracked.txt");
   fs::write(&file, "tracked").unwrap();

   let search = FffSearch::new(&db_path).unwrap();

   assert!(db_path.parent().unwrap().is_dir());
   search.track_access(&file).unwrap();
   create_search(false).track_access(&file).unwrap();
}
