//! End-to-end tests for the git commands against throwaway repositories.
//!
//! Repositories are created with libgit2 and given a local identity so the
//! tests never depend on the runner's global git configuration. Commands that
//! shell out (stash, worktree, hunk staging) need the `git` CLI, which CI has.

use athas_version_control::{
   DiffLineType, FileStatus, GitDiffLine, GitHunk, format_git_time, get_ahead_behind_counts,
   git_add, git_add_all, git_add_worktree, git_branches, git_checkout, git_commit,
   git_create_branch, git_create_stash, git_create_tag, git_delete_branch, git_delete_tag,
   git_discard_all_changes, git_discard_file_changes, git_get_stashes, git_get_tags,
   git_get_worktrees, git_log, git_pop_stash, git_remove_worktree, git_reset, git_reset_all,
   git_stage_hunk, git_status, git_unstage_hunk, is_image_file,
};
use git2::{Repository, Signature, Time};
use std::{fs, path::Path};
use tempfile::TempDir;

struct TestRepo {
   _dir: TempDir,
   path: String,
   repo: Repository,
}

impl TestRepo {
   fn new() -> Self {
      let dir = TempDir::new().unwrap();
      let repo = Repository::init(dir.path()).unwrap();
      {
         let mut config = repo.config().unwrap();
         config.set_str("user.name", "Test User").unwrap();
         config.set_str("user.email", "test@example.com").unwrap();
         config.set_bool("commit.gpgsign", false).unwrap();
         config.set_bool("tag.gpgsign", false).unwrap();
         config.set_bool("core.autocrlf", false).unwrap();
      }
      let path = dir.path().to_string_lossy().into_owned();
      Self {
         _dir: dir,
         path,
         repo,
      }
   }

   fn with_commit(files: &[(&str, &str)]) -> Self {
      let repo = Self::new();
      for (name, contents) in files {
         repo.write(name, contents);
      }
      repo.commit_all("Initial commit", 1_700_000_000);
      repo
   }

   fn root(&self) -> &Path {
      self._dir.path()
   }

   fn write(&self, name: &str, contents: &str) {
      let path = self.root().join(name);
      if let Some(parent) = path.parent() {
         fs::create_dir_all(parent).unwrap();
      }
      fs::write(path, contents).unwrap();
   }

   fn read(&self, name: &str) -> String {
      fs::read_to_string(self.root().join(name)).unwrap()
   }

   fn commit_all(&self, message: &str, seconds: i64) -> git2::Oid {
      let mut index = self.repo.index().unwrap();
      index.read(true).unwrap();
      index
         .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
         .unwrap();
      index.update_all(["*"].iter(), None).unwrap();
      index.write().unwrap();
      let tree = self.repo.find_tree(index.write_tree().unwrap()).unwrap();
      let signature =
         Signature::new("Test User", "test@example.com", &Time::new(seconds, 0)).unwrap();
      let parents: Vec<git2::Commit> = self
         .repo
         .head()
         .ok()
         .and_then(|head| head.peel_to_commit().ok())
         .into_iter()
         .collect();
      let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
      self
         .repo
         .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parent_refs,
         )
         .unwrap()
   }

   fn head_branch(&self) -> String {
      self.repo.head().unwrap().shorthand().unwrap().to_string()
   }

   fn status(&self) -> Vec<(String, FileStatus, bool)> {
      let mut files: Vec<_> = git_status(self.path.clone())
         .unwrap()
         .files
         .into_iter()
         .map(|file| (file.path, file.status, file.staged))
         .collect();
      files.sort_by(|a, b| a.0.cmp(&b.0).then(a.2.cmp(&b.2)));
      files
   }

   fn index_blob(&self, name: &str) -> Option<String> {
      let mut index = self.repo.index().unwrap();
      index.read(true).unwrap();
      let entry = index.get_path(Path::new(name), 0)?;
      let blob = self.repo.find_blob(entry.id).unwrap();
      Some(String::from_utf8(blob.content().to_vec()).unwrap())
   }
}

fn entry(path: &str, status: FileStatus, staged: bool) -> (String, FileStatus, bool) {
   (path.to_string(), status, staged)
}

#[test]
fn commit_records_the_index_and_log_reports_it_newest_first() {
   let repo = TestRepo::with_commit(&[("a.txt", "one\n")]);
   repo.write("a.txt", "two\n");
   git_add(repo.path.clone(), "a.txt".to_string()).unwrap();

   git_commit(
      repo.path.clone(),
      "Update a\n\nExplain why a changed.\n".to_string(),
   )
   .unwrap();

   let log = git_log(repo.path.clone(), None, None).unwrap();
   assert_eq!(log.len(), 2);
   assert_eq!(log[0].message, "Update a");
   assert_eq!(
      log[0].description.as_deref(),
      Some("Explain why a changed.")
   );
   assert_eq!(log[0].author, "Test User");
   assert_eq!(log[0].email, "test@example.com");
   assert_eq!(log[1].message, "Initial commit");
   assert_eq!(log[1].description, None);
   assert_eq!(log[1].date, "2023-11-14");
   assert!(repo.status().is_empty());
}

#[test]
fn log_supports_limit_and_skip() {
   let repo = TestRepo::with_commit(&[("a.txt", "0")]);
   for index in 1..=4 {
      repo.write("a.txt", &index.to_string());
      repo.commit_all(&format!("Commit {index}"), 1_700_000_000 + index * 60);
   }

   let page = git_log(repo.path.clone(), Some(2), Some(1)).unwrap();
   let messages: Vec<_> = page.iter().map(|commit| commit.message.as_str()).collect();
   assert_eq!(messages, vec!["Commit 3", "Commit 2"]);
   assert!(
      git_log(repo.path.clone(), Some(10), Some(10))
         .unwrap()
         .is_empty()
   );
}

#[test]
fn staging_and_unstaging_single_files() {
   let repo = TestRepo::with_commit(&[("tracked.txt", "base\n")]);
   repo.write("tracked.txt", "changed\n");
   repo.write("new/file.txt", "new\n");

   assert!(
      repo
         .status()
         .contains(&entry("tracked.txt", FileStatus::Modified, false))
   );

   git_add(repo.path.clone(), "tracked.txt".to_string()).unwrap();
   git_add(repo.path.clone(), "new".to_string()).unwrap();
   assert_eq!(repo.index_blob("tracked.txt").as_deref(), Some("changed\n"));
   assert_eq!(repo.index_blob("new/file.txt").as_deref(), Some("new\n"));
   assert!(
      repo
         .status()
         .contains(&entry("tracked.txt", FileStatus::Modified, true))
   );

   git_reset(repo.path.clone(), "tracked.txt".to_string()).unwrap();
   git_reset(repo.path.clone(), "new/file.txt".to_string()).unwrap();
   assert_eq!(repo.index_blob("tracked.txt").as_deref(), Some("base\n"));
   assert_eq!(repo.index_blob("new/file.txt"), None);
   assert_eq!(repo.read("tracked.txt"), "changed\n");
}

#[test]
fn add_all_and_reset_all_cover_new_and_modified_files() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n")]);
   repo.write("a.txt", "a2\n");
   repo.write("b.txt", "b\n");

   git_add_all(repo.path.clone()).unwrap();
   assert_eq!(
      repo.status(),
      vec![
         entry("a.txt", FileStatus::Modified, true),
         entry("b.txt", FileStatus::Added, true),
      ]
   );

   git_reset_all(repo.path.clone()).unwrap();
   assert_eq!(
      repo.status(),
      vec![
         entry("a.txt", FileStatus::Modified, false),
         entry("b.txt", FileStatus::Untracked, false),
      ]
   );
}

#[test]
fn staging_a_deleted_file_records_the_deletion() {
   for stage_all in [false, true] {
      let repo = TestRepo::with_commit(&[("gone.txt", "bye\n"), ("kept.txt", "k\n")]);
      fs::remove_file(repo.root().join("gone.txt")).unwrap();

      if stage_all {
         git_add_all(repo.path.clone()).unwrap();
      } else {
         git_add(repo.path.clone(), "gone.txt".to_string()).unwrap();
      }

      assert_eq!(
         repo.status(),
         vec![entry("gone.txt", FileStatus::Deleted, true)],
         "stage_all={stage_all}"
      );
      assert_eq!(repo.index_blob("gone.txt"), None);
   }
}

#[test]
fn discarding_restores_head_content() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n"), ("b.txt", "b\n")]);
   repo.write("a.txt", "dirty a\n");
   repo.write("b.txt", "dirty b\n");

   git_discard_file_changes(repo.path.clone(), "a.txt".to_string()).unwrap();
   assert_eq!(repo.read("a.txt"), "a\n");
   assert_eq!(repo.read("b.txt"), "dirty b\n");

   git_add(repo.path.clone(), "b.txt".to_string()).unwrap();
   git_discard_all_changes(repo.path.clone()).unwrap();
   assert_eq!(repo.read("b.txt"), "b\n");
   assert!(repo.status().is_empty());
}

#[test]
fn branches_can_be_created_switched_and_deleted() {
   let repo = TestRepo::with_commit(&[("a.txt", "main\n")]);
   let main = repo.head_branch();

   git_create_branch(repo.path.clone(), "feature".to_string(), None).unwrap();
   assert_eq!(repo.head_branch(), "feature");
   repo.write("a.txt", "feature\n");
   repo.commit_all("Feature change", 1_700_000_100);

   let mut branches = git_branches(repo.path.clone()).unwrap();
   branches.sort();
   let mut expected = vec!["feature".to_string(), main.clone()];
   expected.sort();
   assert_eq!(branches, expected);

   let switched = git_checkout(repo.path.clone(), main.clone()).unwrap();
   assert!(switched.success && !switched.has_changes);
   assert_eq!(repo.head_branch(), main);
   assert_eq!(repo.read("a.txt"), "main\n");

   git_create_branch(
      repo.path.clone(),
      "from-feature".to_string(),
      Some("feature".to_string()),
   )
   .unwrap();
   assert_eq!(repo.read("a.txt"), "feature\n");

   git_checkout(repo.path.clone(), main.clone()).unwrap();
   git_delete_branch(repo.path.clone(), "from-feature".to_string()).unwrap();
   assert!(
      !git_branches(repo.path.clone())
         .unwrap()
         .contains(&"from-feature".to_string())
   );
   assert!(git_delete_branch(repo.path.clone(), "missing".to_string()).is_err());
}

#[test]
fn checkout_is_refused_while_the_worktree_has_changes() {
   let repo = TestRepo::with_commit(&[("a.txt", "main\n")]);
   let main = repo.head_branch();
   git_create_branch(repo.path.clone(), "other".to_string(), None).unwrap();
   repo.write("a.txt", "uncommitted\n");

   let result = git_checkout(repo.path.clone(), main).unwrap();

   assert!(!result.success);
   assert!(result.has_changes);
   assert_eq!(repo.head_branch(), "other");
   assert_eq!(repo.read("a.txt"), "uncommitted\n");
}

#[test]
fn tags_list_lightweight_and_annotated_and_can_be_deleted() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n")]);
   let head = repo.repo.head().unwrap().target().unwrap().to_string();

   git_create_tag(repo.path.clone(), "v1".to_string(), None, None, false).unwrap();
   git_create_tag(
      repo.path.clone(),
      "v1-notes".to_string(),
      Some("Release notes".to_string()),
      Some("HEAD".to_string()),
      false,
   )
   .unwrap();
   assert!(git_create_tag(repo.path.clone(), "v1".to_string(), None, None, false).is_err());

   let tags = git_get_tags(repo.path.clone()).unwrap();
   let lightweight = tags.iter().find(|tag| tag.name == "v1").unwrap();
   assert!(!lightweight.is_annotated);
   assert_eq!(lightweight.commit, head);
   assert_eq!(lightweight.message, None);
   assert_eq!(lightweight.date, format_git_time(Some(1_700_000_000)));

   let annotated = tags.iter().find(|tag| tag.name == "v1-notes").unwrap();
   assert!(annotated.is_annotated);
   assert_eq!(annotated.commit, head);
   assert_eq!(
      annotated.message.as_deref().map(str::trim),
      Some("Release notes")
   );

   git_delete_tag(repo.path.clone(), "v1".to_string()).unwrap();
   let names: Vec<_> = git_get_tags(repo.path.clone())
      .unwrap()
      .into_iter()
      .map(|tag| tag.name)
      .collect();
   assert_eq!(names, vec!["v1-notes"]);
}

#[test]
fn stashes_are_listed_with_clean_messages_and_can_be_popped() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n")]);
   repo.write("a.txt", "first stash\n");
   git_create_stash(repo.path.clone(), Some("First".to_string()), false, None).unwrap();
   repo.write("a.txt", "second stash\n");
   repo.write("untracked.txt", "u\n");
   git_create_stash(repo.path.clone(), Some("Second".to_string()), true, None).unwrap();
   assert_eq!(repo.read("a.txt"), "a\n");
   assert!(!repo.root().join("untracked.txt").exists());

   let stashes = git_get_stashes(repo.path.clone()).unwrap();
   let messages: Vec<_> = stashes.iter().map(|stash| stash.message.as_str()).collect();
   assert_eq!(messages, vec!["Second", "First"]);
   assert_eq!(stashes[0].index, 0);
   assert!(!stashes[0].date.is_empty());

   git_pop_stash(repo.path.clone(), Some(1)).unwrap();
   assert_eq!(repo.read("a.txt"), "first stash\n");
   assert_eq!(git_get_stashes(repo.path.clone()).unwrap().len(), 1);
}

#[test]
fn stash_messages_keep_pipe_characters() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n")]);
   repo.write("a.txt", "b\n");

   git_create_stash(repo.path.clone(), Some("fix a|b".to_string()), false, None).unwrap();

   let stashes = git_get_stashes(repo.path.clone()).unwrap();
   assert_eq!(stashes[0].message, "fix a|b");
   assert!(stashes[0].date.starts_with("20"), "{}", stashes[0].date);
}

#[test]
fn stash_listing_rejects_non_repositories() {
   let dir = TempDir::new().unwrap();
   assert!(git_get_stashes(dir.path().to_string_lossy().into_owned()).is_err());
}

fn line(line_type: DiffLineType, content: &str) -> GitDiffLine {
   GitDiffLine {
      line_type,
      content: content.to_string(),
      old_line_number: None,
      new_line_number: None,
   }
}

#[test]
fn hunks_can_be_staged_and_unstaged_through_git_apply() {
   let repo = TestRepo::with_commit(&[("code.txt", "one\ntwo\nthree\n")]);
   repo.write("code.txt", "one\nTWO\nthree\n");
   let hunk = || GitHunk {
      file_path: "code.txt".to_string(),
      lines: vec![
         line(DiffLineType::Header, "@@ -1,3 +1,3 @@"),
         line(DiffLineType::Context, "one"),
         line(DiffLineType::Removed, "two"),
         line(DiffLineType::Added, "TWO"),
         line(DiffLineType::Context, "three"),
      ],
   };

   git_stage_hunk(repo.path.clone(), hunk()).unwrap();
   assert_eq!(
      repo.index_blob("code.txt").as_deref(),
      Some("one\nTWO\nthree\n")
   );

   git_unstage_hunk(repo.path.clone(), hunk()).unwrap();
   assert_eq!(
      repo.index_blob("code.txt").as_deref(),
      Some("one\ntwo\nthree\n")
   );
   assert_eq!(repo.read("code.txt"), "one\nTWO\nthree\n");
}

#[test]
fn hunks_without_a_header_or_matching_content_are_rejected() {
   let repo = TestRepo::with_commit(&[("code.txt", "one\n")]);
   let headerless = GitHunk {
      file_path: "code.txt".to_string(),
      lines: vec![line(DiffLineType::Added, "x")],
   };
   let error = git_stage_hunk(repo.path.clone(), headerless).unwrap_err();
   assert!(error.contains("No header line"), "{error}");

   let stale = GitHunk {
      file_path: "code.txt".to_string(),
      lines: vec![
         line(DiffLineType::Header, "@@ -1 +1 @@"),
         line(DiffLineType::Removed, "not in file"),
         line(DiffLineType::Added, "x"),
      ],
   };
   let error = git_stage_hunk(repo.path.clone(), stale).unwrap_err();
   assert!(error.contains("Failed to stage hunk"), "{error}");
}

#[test]
fn worktrees_can_be_added_listed_and_removed() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n")]);
   let parent = TempDir::new().unwrap();
   let worktree_path = parent.path().join("feature-tree");
   let worktree = worktree_path.to_string_lossy().into_owned();

   git_add_worktree(
      repo.path.clone(),
      worktree.clone(),
      Some("tree-branch".to_string()),
      true,
   )
   .unwrap();
   assert!(worktree_path.join("a.txt").is_file());

   let worktrees = git_get_worktrees(repo.path.clone()).unwrap();
   assert_eq!(worktrees.len(), 2);
   assert_eq!(worktrees.iter().filter(|tree| tree.is_current).count(), 1);
   let added = worktrees
      .iter()
      .find(|tree| tree.branch.as_deref() == Some("tree-branch"))
      .unwrap();
   assert!(!added.is_current && !added.is_detached && !added.is_bare);
   assert_eq!(
      Path::new(&added.path).canonicalize().unwrap(),
      worktree_path.canonicalize().unwrap()
   );

   assert!(
      git_add_worktree(repo.path.clone(), "  ".to_string(), None, false)
         .unwrap_err()
         .contains("path is required")
   );
   assert!(
      git_add_worktree(repo.path.clone(), worktree.clone(), None, true)
         .unwrap_err()
         .contains("Branch name is required")
   );

   git_remove_worktree(repo.path.clone(), worktree, false).unwrap();
   assert!(!worktree_path.exists());
   assert_eq!(git_get_worktrees(repo.path.clone()).unwrap().len(), 1);
}

#[test]
fn ahead_behind_counts_follow_the_upstream_branch() {
   let repo = TestRepo::with_commit(&[("a.txt", "a\n")]);
   let main = repo.head_branch();
   let base = repo.repo.head().unwrap().peel_to_commit().unwrap();
   repo.repo.branch("upstream", &base, false).unwrap();
   assert_eq!(get_ahead_behind_counts(&repo.repo, &main), (0, 0));

   let mut local = repo
      .repo
      .find_branch(&main, git2::BranchType::Local)
      .unwrap();
   local.set_upstream(Some("upstream")).unwrap();
   repo.write("a.txt", "ahead 1\n");
   repo.commit_all("Ahead 1", 1_700_000_100);
   repo.write("a.txt", "ahead 2\n");
   repo.commit_all("Ahead 2", 1_700_000_200);

   assert_eq!(get_ahead_behind_counts(&repo.repo, &main), (2, 0));
   assert_eq!(get_ahead_behind_counts(&repo.repo, "missing"), (0, 0));
}

#[test]
fn recognizes_image_paths_and_formats_commit_times() {
   assert!(is_image_file("assets/Logo.PNG"));
   assert!(is_image_file("photo.heic"));
   assert!(!is_image_file("image.png.txt"));
   assert!(!is_image_file("README.md"));

   assert_eq!(format_git_time(Some(0)), "1970-01-01 00:00:00");
   assert_eq!(format_git_time(Some(1_700_000_000)), "2023-11-14 22:13:20");
   assert_eq!(format_git_time(None), "");
}

#[test]
fn first_commit_in_a_new_repository_has_no_parent() {
   let repo = TestRepo::new();
   repo.write("a.txt", "a\n");
   git_add(repo.path.clone(), "a.txt".to_string()).unwrap();

   git_commit(repo.path.clone(), "First".to_string()).unwrap();

   let head = repo.repo.head().unwrap().peel_to_commit().unwrap();
   assert_eq!(head.parent_count(), 0);
   assert_eq!(head.summary(), Some("First"));
   assert!(repo.status().is_empty());
}

#[test]
fn unstaging_works_before_the_first_commit() {
   let repo = TestRepo::new();
   repo.write("a.txt", "a\n");
   repo.write("b.txt", "b\n");
   git_add_all(repo.path.clone()).unwrap();

   git_reset(repo.path.clone(), "a.txt".to_string()).unwrap();
   assert_eq!(repo.index_blob("a.txt"), None);
   assert_eq!(repo.index_blob("b.txt").as_deref(), Some("b\n"));

   git_reset_all(repo.path.clone()).unwrap();
   assert_eq!(repo.index_blob("b.txt"), None);
   assert_eq!(
      repo.status(),
      vec![
         entry("a.txt", FileStatus::Untracked, false),
         entry("b.txt", FileStatus::Untracked, false),
      ]
   );
}
