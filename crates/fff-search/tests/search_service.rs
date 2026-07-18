use athas_fff_search::{FffGrepOptions, FffSearch};
use fff_search::GrepMode;
use std::{fs, sync::Mutex, time::Duration};
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
