use crate::git::{GitBlame, GitBlameCommit, GitBlameHunk};
use git2::{BlameOptions, Commit, DiffOptions, Oid, Patch, Repository};
use std::{
   collections::{HashMap, VecDeque},
   path::{Path, PathBuf},
   sync::{Arc, Mutex},
};

/// How many committed blames are kept. Each holds line ranges and commit metadata, not file text.
const BLAME_CACHE_CAPACITY: usize = 32;

/// How many files one prewarm request blames. The rest are blamed when they are first shown.
const PREWARM_FILE_LIMIT: usize = 5;

/// How many repositories can wait for a prewarm at once. Older requests are dropped beyond this.
const PREWARM_QUEUE_LIMIT: usize = 4;

static BLAME_CACHE: BlameCache = BlameCache::new(BLAME_CACHE_CAPACITY);
static PREWARM_QUEUE: PrewarmQueue = PrewarmQueue::new();

struct CommitAuthor {
   name: String,
   email: String,
   time: i64,
}

impl Default for CommitAuthor {
   fn default() -> Self {
      Self {
         name: "Unknown".to_string(),
         email: String::new(),
         time: 0,
      }
   }
}

fn parse_author_header(header: &[u8]) -> CommitAuthor {
   let header = String::from_utf8_lossy(header);
   let Some(email_end) = header.rfind('>') else {
      return CommitAuthor::default();
   };
   let Some(email_start) = header[..email_end].rfind('<') else {
      return CommitAuthor::default();
   };

   let name = header[..email_start].trim();
   let email = header[email_start + 1..email_end].trim();
   let time = header[email_end + 1..]
      .split_whitespace()
      .next()
      .and_then(|value| value.parse().ok())
      .unwrap_or(0);

   CommitAuthor {
      name: if name.is_empty() {
         "Unknown".to_string()
      } else {
         name.to_string()
      },
      email: email.to_string(),
      time,
   }
}

fn get_commit_author(commit: &Commit<'_>) -> CommitAuthor {
   commit
      .header_field_bytes("author")
      .map(|header| parse_author_header(&header))
      .unwrap_or_default()
}

/// The blame of a file as committed at one HEAD. Walking history for it is the expensive part of
/// blame, so it is computed once per (repository, path, HEAD, blob) and reused for every edit.
#[derive(Debug)]
struct CommittedBlame {
   commits: Vec<GitBlameCommit>,
   hunks: Vec<GitBlameHunk>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BlameCacheKey {
   repo_dir: PathBuf,
   file_path: String,
   head: Oid,
   blob: Oid,
}

/// A small most-recently-used list. A changed HEAD or blob is a different key, so stale entries
/// are never returned and age out on their own.
struct BlameCache {
   capacity: usize,
   entries: Mutex<VecDeque<(BlameCacheKey, Arc<CommittedBlame>)>>,
   /// One lock per blame being computed, so a request that arrives during a prewarm of the same
   /// file waits for it instead of walking history a second time.
   computing: Mutex<Vec<(BlameCacheKey, Arc<Mutex<()>>)>>,
}

impl BlameCache {
   const fn new(capacity: usize) -> Self {
      Self {
         capacity,
         entries: Mutex::new(VecDeque::new()),
         computing: Mutex::new(Vec::new()),
      }
   }

   fn computing_lock(&self, key: &BlameCacheKey) -> Arc<Mutex<()>> {
      let mut computing = self.computing.lock().unwrap_or_else(|e| e.into_inner());
      if let Some((_, lock)) = computing.iter().find(|(entry_key, _)| entry_key == key) {
         return Arc::clone(lock);
      }
      let lock = Arc::new(Mutex::new(()));
      computing.push((key.clone(), Arc::clone(&lock)));
      lock
   }

   fn finish_computing(&self, key: &BlameCacheKey, lock: &Arc<Mutex<()>>) {
      let mut computing = self.computing.lock().unwrap_or_else(|e| e.into_inner());
      computing
         .retain(|(entry_key, entry_lock)| entry_key != key || !Arc::ptr_eq(entry_lock, lock));
   }

   /// The cached blame for `key`, computing it with `load` when missing. Concurrent callers for
   /// the same key share one computation.
   fn get_or_load(
      &self,
      key: BlameCacheKey,
      load: impl FnOnce() -> Result<CommittedBlame, String>,
   ) -> Result<Arc<CommittedBlame>, String> {
      if let Some(blame) = self.get(&key) {
         return Ok(blame);
      }
      let lock = self.computing_lock(&key);
      let result = {
         let _computing = lock.lock().unwrap_or_else(|e| e.into_inner());
         match self.get(&key) {
            Some(blame) => Ok(blame),
            None => load().map(|blame| {
               let blame = Arc::new(blame);
               self.insert(key.clone(), Arc::clone(&blame));
               blame
            }),
         }
      };
      self.finish_computing(&key, &lock);
      result
   }

   fn get(&self, key: &BlameCacheKey) -> Option<Arc<CommittedBlame>> {
      let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
      let index = entries.iter().position(|(entry_key, _)| entry_key == key)?;
      let entry = entries.remove(index)?;
      let blame = Arc::clone(&entry.1);
      entries.push_front(entry);
      Some(blame)
   }

   fn insert(&self, key: BlameCacheKey, blame: Arc<CommittedBlame>) {
      let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
      entries.retain(|(entry_key, _)| entry_key != &key);
      entries.push_front((key, blame));
      entries.truncate(self.capacity);
   }

   #[cfg(test)]
   fn len(&self) -> usize {
      self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
   }
}

pub fn git_blame_file(root_path: &str, file_path: &str, content: &str) -> Result<GitBlame, String> {
   blame_file_with_cache(&BLAME_CACHE, root_path, file_path, content)
}

fn blame_file_with_cache(
   cache: &BlameCache,
   root_path: &str,
   file_path: &str,
   content: &str,
) -> Result<GitBlame, String> {
   let repo =
      Repository::open(root_path).map_err(|e| format!("Failed to open repository: {}", e))?;
   let (committed, blob) = committed_blame(cache, &repo, file_path)?;
   let committed_blob = repo
      .find_blob(blob)
      .map_err(|e| format!("Failed to read committed '{}': {}", file_path, e))?;
   let hunks = blame_buffer(
      &committed.hunks,
      committed_blob.content(),
      content.as_bytes(),
   )
   .map_err(|e| {
      format!(
         "Failed to get blame for editor content '{}': {}",
         file_path, e
      )
   })?;

   if hunks.is_empty() {
      return Err(format!(
         "No blame information available for file '{}'",
         file_path
      ));
   }

   Ok(GitBlame {
      file_path: file_path.to_string(),
      commits: committed.commits.clone(),
      hunks,
   })
}

/// The committed blame for `file_path` at HEAD, from the cache when HEAD and the file's blob are
/// unchanged. Also returns the blob, which buffer blame diffs against.
fn committed_blame(
   cache: &BlameCache,
   repo: &Repository,
   file_path: &str,
) -> Result<(Arc<CommittedBlame>, Oid), String> {
   let blame_error =
      |e: git2::Error| format!("Failed to get blame for file '{}': {}", file_path, e);
   let head = repo
      .head()
      .and_then(|head| head.peel_to_commit())
      .map_err(blame_error)?;
   let blob = head
      .tree()
      .and_then(|tree| tree.get_path(Path::new(file_path)))
      .map_err(blame_error)?
      .id();
   let key = BlameCacheKey {
      repo_dir: repo.path().to_path_buf(),
      file_path: file_path.to_string(),
      head: head.id(),
      blob,
   };

   // Deepening a shallow clone changes blame without moving HEAD or the blob, so it is not cached.
   let load = || load_committed_blame(repo, file_path, head.id());
   let blame = if repo.is_shallow() {
      Arc::new(load()?)
   } else {
      cache.get_or_load(key, load)?
   };
   Ok((blame, blob))
}

struct PrewarmJob {
   root_path: String,
   file_paths: Vec<String>,
}

struct PrewarmState {
   pending: VecDeque<PrewarmJob>,
   running: bool,
}

/// Prewarm requests waiting for the single prewarm thread. A newer request for a repository
/// replaces the one still waiting, so bursts of git events collapse into one pass.
struct PrewarmQueue {
   state: Mutex<PrewarmState>,
}

impl PrewarmQueue {
   const fn new() -> Self {
      Self {
         state: Mutex::new(PrewarmState {
            pending: VecDeque::new(),
            running: false,
         }),
      }
   }

   /// Queues a job. Returns true when no thread is draining the queue and the caller must start
   /// one.
   fn push(&self, job: PrewarmJob) -> bool {
      let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
      state
         .pending
         .retain(|pending| pending.root_path != job.root_path);
      state.pending.push_back(job);
      while state.pending.len() > PREWARM_QUEUE_LIMIT {
         state.pending.pop_front();
      }
      !std::mem::replace(&mut state.running, true)
   }

   /// Runs jobs until the queue is empty. A job that panics is skipped, so the queue still ends
   /// idle and later requests start a new thread.
   fn drain(&self, mut run: impl FnMut(&PrewarmJob)) {
      while let Some(job) = self.next() {
         if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&job))).is_err() {
            log::warn!("Blame prewarm for '{}' panicked", job.root_path);
         }
      }
   }

   /// The next job, or None after marking the queue idle.
   fn next(&self) -> Option<PrewarmJob> {
      let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
      let job = state.pending.pop_front();
      state.running = job.is_some();
      job
   }
}

/// Computes the committed blame of up to five files in the background, so the first blame after
/// HEAD moves (commit, checkout, branch switch) is served from the cache. Returns at once; one
/// thread does the work, and failures are ignored because the real request reports them.
pub fn git_prewarm_blame(root_path: String, file_paths: Vec<String>) {
   if file_paths.is_empty() {
      return;
   }
   let job = PrewarmJob {
      root_path,
      file_paths,
   };
   if !PREWARM_QUEUE.push(job) {
      return;
   }
   let spawned = std::thread::Builder::new()
      .name("git-blame-prewarm".to_string())
      .spawn(|| {
         PREWARM_QUEUE.drain(|job| prewarm_blame(&BLAME_CACHE, &job.root_path, &job.file_paths))
      });
   if let Err(error) = spawned {
      log::warn!("Failed to start blame prewarm: {}", error);
      while PREWARM_QUEUE.next().is_some() {}
   }
}

fn prewarm_blame(cache: &BlameCache, root_path: &str, file_paths: &[String]) {
   let Ok(repo) = Repository::open(root_path) else {
      return;
   };
   for file_path in file_paths.iter().take(PREWARM_FILE_LIMIT) {
      if let Err(error) = committed_blame(cache, &repo, file_path) {
         log::debug!("Skipped blame prewarm for '{}': {}", file_path, error);
      }
   }
}

fn load_committed_blame(
   repo: &Repository,
   file_path: &str,
   head: Oid,
) -> Result<CommittedBlame, String> {
   let mut options = BlameOptions::new();
   options.newest_commit(head);
   let blame = repo
      .blame_file(Path::new(file_path), Some(&mut options))
      .map_err(|e| format!("Failed to get blame for file '{}': {}", file_path, e))?;

   let mut commits = Vec::new();
   let mut commit_indexes = HashMap::new();
   let mut hunks = Vec::with_capacity(blame.len());

   for hunk in blame.iter() {
      let commit_id = hunk.final_commit_id();
      let commit_index = if commit_id.is_zero() {
         None
      } else if let Some(index) = commit_indexes.get(&commit_id) {
         Some(*index)
      } else {
         let commit = repo
            .find_commit(commit_id)
            .map_err(|e| format!("Failed to load blame commit '{}': {}", commit_id, e))?;
         let author = get_commit_author(&commit);
         commits.push(GitBlameCommit {
            hash: commit_id.to_string(),
            author: author.name,
            email: author.email,
            time: author.time,
            message: commit.message().unwrap_or("").to_string(),
         });
         commit_indexes.insert(commit_id, commits.len() - 1);
         Some(commits.len() - 1)
      };

      hunks.push(GitBlameHunk {
         line_number: hunk.final_start_line(),
         total_lines: hunk.lines_in_hunk(),
         commit_index,
      });
   }

   Ok(CommittedBlame { commits, hunks })
}

/// Collects output hunks, joining a hunk onto the previous one when it continues the same commit.
#[derive(Default)]
struct HunkBuilder {
   hunks: Vec<GitBlameHunk>,
}

impl HunkBuilder {
   fn push(&mut self, line_number: usize, total_lines: usize, commit_index: Option<usize>) {
      if total_lines == 0 {
         return;
      }
      if let Some(last) = self.hunks.last_mut()
         && last.commit_index == commit_index
         && last.line_number + last.total_lines == line_number
      {
         last.total_lines += total_lines;
         return;
      }
      self.hunks.push(GitBlameHunk {
         line_number,
         total_lines,
         commit_index,
      });
   }

   /// Adds `count` unchanged lines that start at `old_line` in the committed file and at
   /// `new_line` in the buffer, carrying over the commits that blame those committed lines.
   fn push_unchanged(
      &mut self,
      committed: &[GitBlameHunk],
      old_line: usize,
      new_line: usize,
      count: usize,
   ) {
      if count == 0 {
         return;
      }
      let old_end = old_line + count;
      let first = committed.partition_point(|hunk| hunk.line_number + hunk.total_lines <= old_line);
      let mut covered = old_line;
      for hunk in &committed[first..] {
         if hunk.line_number >= old_end {
            break;
         }
         let start = hunk.line_number.max(old_line);
         let end = (hunk.line_number + hunk.total_lines).min(old_end);
         if start > covered {
            self.push(new_line + (covered - old_line), start - covered, None);
         }
         self.push(
            new_line + (start - old_line),
            end - start,
            hunk.commit_index,
         );
         covered = end;
      }
      if covered < old_end {
         self.push(new_line + (covered - old_line), old_end - covered, None);
      }
   }
}

fn count_lines(buffer: &[u8]) -> usize {
   let newlines = buffer.iter().filter(|byte| **byte == b'\n').count();
   newlines + usize::from(buffer.last().is_some_and(|byte| *byte != b'\n'))
}

/// Where a diff range starts, counting from 1. An empty range names the line before it.
fn range_start(start: u32, lines: u32) -> usize {
   if lines == 0 {
      start as usize + 1
   } else {
      start as usize
   }
}

/// Moves committed blame onto the buffer the way libgit2's `git_blame_buffer` does: lines the
/// buffer shares with the committed file keep their commit, and the rest are uncommitted.
fn blame_buffer(
   committed: &[GitBlameHunk],
   committed_content: &[u8],
   buffer: &[u8],
) -> Result<Vec<GitBlameHunk>, git2::Error> {
   let mut builder = HunkBuilder::default();
   let mut old_line = 1;
   let mut new_line = 1;

   if committed_content != buffer {
      let mut options = DiffOptions::new();
      options.context_lines(0).force_text(true);
      let patch = Patch::from_buffers(committed_content, None, buffer, None, Some(&mut options))?;
      for index in 0..patch.num_hunks() {
         let (hunk, _) = patch.hunk(index)?;
         let old_start = range_start(hunk.old_start(), hunk.old_lines());
         let new_start = range_start(hunk.new_start(), hunk.new_lines());
         builder.push_unchanged(
            committed,
            old_line,
            new_line,
            new_start.saturating_sub(new_line),
         );
         builder.push(new_start, hunk.new_lines() as usize, None);
         old_line = old_start + hunk.old_lines() as usize;
         new_line = new_start + hunk.new_lines() as usize;
      }
   }

   let total_lines = count_lines(buffer);
   builder.push_unchanged(
      committed,
      old_line,
      new_line,
      (total_lines + 1).saturating_sub(new_line),
   );
   Ok(builder.hunks)
}

#[cfg(test)]
mod tests {
   use super::*;
   use git2::{IndexAddOption, Signature};
   use std::fs;

   fn commit_file(repo: &Repository, relative_path: &str, content: &str, message: &str) -> Oid {
      let workdir = repo.workdir().expect("repository workdir");
      fs::write(workdir.join(relative_path), content).expect("write file");

      let mut index = repo.index().expect("repository index");
      index
         .add_all([relative_path], IndexAddOption::DEFAULT, None)
         .expect("add file");
      index.write().expect("write index");
      let tree_id = index.write_tree().expect("write tree");
      let tree = repo.find_tree(tree_id).expect("find tree");
      let signature = Signature::now("Athas Test", "test@athas.dev").expect("signature");
      let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
      let parents: Vec<&Commit<'_>> = parent.iter().collect();
      repo
         .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
         )
         .expect("commit file")
   }

   fn init_repo() -> (tempfile::TempDir, Repository) {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      (temp_dir, repo)
   }

   fn root(temp_dir: &tempfile::TempDir) -> &str {
      temp_dir.path().to_str().expect("repo path")
   }

   /// The commit hash blamed for each buffer line, counting from 1; empty for uncommitted lines.
   fn hashes_by_line(blame: &GitBlame) -> Vec<String> {
      let mut lines = Vec::new();
      for hunk in &blame.hunks {
         assert_eq!(
            hunk.line_number,
            lines.len() + 1,
            "hunks must be contiguous"
         );
         let hash = hunk
            .commit_index
            .map(|index| blame.commits[index].hash.clone())
            .unwrap_or_default();
         lines.extend(std::iter::repeat_n(hash, hunk.total_lines));
      }
      lines
   }

   fn libgit2_hashes_by_line(repo: &Repository, file_path: &str, buffer: &str) -> Vec<String> {
      let committed = repo.blame_file(Path::new(file_path), None).expect("blame");
      let blame = committed
         .blame_buffer(buffer.as_bytes())
         .expect("blame buffer");
      let mut lines = Vec::new();
      for hunk in blame.iter() {
         let id = hunk.final_commit_id();
         let hash = if id.is_zero() {
            String::new()
         } else {
            id.to_string()
         };
         lines.extend(std::iter::repeat_n(hash, hunk.lines_in_hunk()));
      }
      lines
   }

   #[test]
   fn aligns_blame_with_inserted_editor_content() {
      let (temp_dir, repo) = init_repo();
      let commit = commit_file(&repo, "example.txt", "first\nsecond\n", "Initial commit");

      let blame = git_blame_file(root(&temp_dir), "example.txt", "inserted\nfirst\nsecond\n")
         .expect("blame editor content");

      assert_eq!(
         hashes_by_line(&blame),
         ["".to_string(), commit.to_string(), commit.to_string()]
      );
      assert_eq!(blame.commits.len(), 1);
      assert_eq!(blame.commits[0].author, "Athas Test");
      assert_eq!(blame.commits[0].message, "Initial commit");
   }

   #[test]
   fn aligns_blame_after_deleting_a_committed_line() {
      let (temp_dir, repo) = init_repo();
      let commit = commit_file(&repo, "example.txt", "first\nsecond\n", "Initial commit");

      let blame =
         git_blame_file(root(&temp_dir), "example.txt", "second\n").expect("blame editor content");

      assert_eq!(hashes_by_line(&blame), [commit.to_string()]);
   }

   #[test]
   fn lists_each_commit_once_and_matches_libgit2_buffer_blame() {
      let (temp_dir, repo) = init_repo();
      let first = commit_file(&repo, "example.txt", "a\nb\nc\nd\ne\n", "First");
      let second = commit_file(&repo, "example.txt", "a\nB\nc\nd\nE\n", "Second");

      let committed = git_blame_file(root(&temp_dir), "example.txt", "a\nB\nc\nd\nE\n")
         .expect("blame committed content");
      assert_eq!(committed.commits.len(), 2);
      assert_eq!(
         hashes_by_line(&committed),
         [first, second, first, first, second].map(|id| id.to_string())
      );

      // libgit2's own buffer blame is only sound for edits that add or change lines; it reports
      // overflowing hunk lengths once lines are deleted, so deletions are checked by hand below.
      for buffer in [
         "a\nB\nc\nd\nE\n",
         "x\na\nB\nc\nd\nE\n",
         "a\nB\nnew\nc\nd\nE\n",
         "a\nB\nc\nd\nE\nmore\n",
      ] {
         let expected = libgit2_hashes_by_line(&repo, "example.txt", buffer);
         let actual = git_blame_file(root(&temp_dir), "example.txt", buffer)
            .map(|blame| hashes_by_line(&blame))
            .expect("blame buffer");
         assert_eq!(actual, expected, "buffer {:?}", buffer);
      }

      let (first, second) = (first.to_string(), second.to_string());
      let none = String::new();
      for (buffer, expected) in [
         ("a\nc\nd\n", vec![&first, &first, &first]),
         (
            "a\nB\nc\nd\nE",
            vec![&first, &second, &first, &first, &none],
         ),
         (
            "changed\nB\nc\nchanged\nE\n",
            vec![&none, &second, &first, &none, &second],
         ),
         ("only new\n", vec![&none]),
      ] {
         let actual = git_blame_file(root(&temp_dir), "example.txt", buffer)
            .map(|blame| hashes_by_line(&blame))
            .expect("blame buffer");
         assert_eq!(
            actual,
            expected.into_iter().cloned().collect::<Vec<_>>(),
            "buffer {:?}",
            buffer
         );
      }
      assert!(git_blame_file(root(&temp_dir), "example.txt", "").is_err());
   }

   #[test]
   fn reuses_committed_blame_until_head_changes() {
      let (temp_dir, repo) = init_repo();
      commit_file(&repo, "example.txt", "first\nsecond\n", "Initial commit");
      let cache = BlameCache::new(4);

      let (first, _) = committed_blame(&cache, &repo, "example.txt").expect("first blame");
      blame_file_with_cache(&cache, root(&temp_dir), "example.txt", "edited\nsecond\n")
         .expect("blame edited buffer");
      let (second, _) = committed_blame(&cache, &repo, "example.txt").expect("second blame");
      assert!(Arc::ptr_eq(&first, &second));
      assert_eq!(cache.len(), 1);

      let commit = commit_file(
         &repo,
         "example.txt",
         "first\nchanged\n",
         "Change second line",
      );
      let (after_commit, _) = committed_blame(&cache, &repo, "example.txt").expect("new blame");
      assert!(!Arc::ptr_eq(&first, &after_commit));
      assert_eq!(cache.len(), 2);

      let blame = blame_file_with_cache(&cache, root(&temp_dir), "example.txt", "first\nchanged\n")
         .expect("blame after commit");
      assert_eq!(hashes_by_line(&blame)[1], commit.to_string());
   }

   #[test]
   fn does_not_cache_blame_in_a_shallow_clone() {
      let (source_dir, source) = init_repo();
      commit_file(&source, "example.txt", "first\n", "First");
      commit_file(&source, "example.txt", "first\nsecond\n", "Second");

      let clone_dir = tempfile::tempdir().expect("clone dir");
      let status = std::process::Command::new("git")
         .args(["clone", "-q", "--depth", "1"])
         .arg(format!("file://{}", root(&source_dir)))
         .arg(clone_dir.path())
         .status()
         .expect("run git clone");
      assert!(status.success());
      let clone = Repository::open(clone_dir.path()).expect("open clone");
      assert!(clone.is_shallow());

      let cache = BlameCache::new(4);
      let (first, _) = committed_blame(&cache, &clone, "example.txt").expect("first blame");
      let (second, _) = committed_blame(&cache, &clone, "example.txt").expect("second blame");
      assert!(!Arc::ptr_eq(&first, &second));
      assert_eq!(cache.len(), 0);
   }

   #[test]
   fn prewarm_fills_the_cache_for_the_next_blame() {
      let (temp_dir, repo) = init_repo();
      let names: Vec<String> = (0..PREWARM_FILE_LIMIT + 2)
         .map(|index| format!("file-{index}.txt"))
         .collect();
      for name in &names {
         commit_file(&repo, name, "first\nsecond\n", "Add file");
      }
      let mut paths = vec!["missing.txt".to_string()];
      paths.extend(names.iter().cloned());

      let cache = BlameCache::new(16);
      prewarm_blame(&cache, root(&temp_dir), &paths);
      assert_eq!(cache.len(), PREWARM_FILE_LIMIT - 1);

      let before = cache.get(&BlameCacheKey {
         repo_dir: repo.path().to_path_buf(),
         file_path: names[0].clone(),
         head: repo.head().unwrap().peel_to_commit().unwrap().id(),
         blob: repo
            .head()
            .unwrap()
            .peel_to_tree()
            .unwrap()
            .get_path(Path::new(&names[0]))
            .unwrap()
            .id(),
      });
      let (blame, _) = committed_blame(&cache, &repo, &names[0]).expect("blame");
      assert!(Arc::ptr_eq(&before.expect("prewarmed"), &blame));
      assert_eq!(cache.len(), PREWARM_FILE_LIMIT - 1);
   }

   #[test]
   fn concurrent_requests_share_one_computation() {
      let (temp_dir, repo) = init_repo();
      commit_file(&repo, "example.txt", "first\nsecond\n", "Initial commit");
      let cache = BlameCache::new(4);
      let barrier = std::sync::Barrier::new(4);

      let blames: Vec<Arc<CommittedBlame>> = std::thread::scope(|scope| {
         let handles: Vec<_> = (0..4)
            .map(|_| {
               scope.spawn(|| {
                  let repo = Repository::open(root(&temp_dir)).expect("open repo");
                  barrier.wait();
                  committed_blame(&cache, &repo, "example.txt")
                     .expect("blame")
                     .0
               })
            })
            .collect();
         handles
            .into_iter()
            .map(|handle| handle.join().expect("thread"))
            .collect()
      });

      assert!(blames.iter().all(|blame| Arc::ptr_eq(blame, &blames[0])));
      assert_eq!(cache.len(), 1);
      assert!(cache.computing.lock().unwrap().is_empty());
   }

   #[test]
   fn prewarm_queue_survives_a_panicking_job() {
      let queue = PrewarmQueue::new();
      let job = |root: &str| PrewarmJob {
         root_path: root.to_string(),
         file_paths: vec!["file".to_string()],
      };
      assert!(queue.push(job("/panics")));
      assert!(!queue.push(job("/after")));

      let mut ran = Vec::new();
      queue.drain(|job| {
         ran.push(job.root_path.clone());
         if job.root_path == "/panics" {
            panic!("prewarm failed");
         }
      });

      assert_eq!(ran, ["/panics", "/after"]);
      assert!(
         queue.push(job("/next")),
         "an idle queue asks for a new thread"
      );
   }

   #[test]
   fn prewarm_queue_keeps_the_latest_request_per_repository() {
      let queue = PrewarmQueue::new();
      let job = |root: &str, file: &str| PrewarmJob {
         root_path: root.to_string(),
         file_paths: vec![file.to_string()],
      };

      assert!(queue.push(job("/a", "old")));
      assert!(!queue.push(job("/b", "b")));
      assert!(!queue.push(job("/a", "new")));

      let first = queue.next().expect("first job");
      assert_eq!(
         (first.root_path.as_str(), first.file_paths[0].as_str()),
         ("/b", "b")
      );
      let second = queue.next().expect("second job");
      assert_eq!(
         (second.root_path.as_str(), second.file_paths[0].as_str()),
         ("/a", "new")
      );
      assert!(queue.next().is_none());
      assert!(queue.push(job("/c", "c")));

      for index in 0..PREWARM_QUEUE_LIMIT + 2 {
         queue.push(job(&format!("/repo-{index}"), "file"));
      }
      assert_eq!(
         queue.state.lock().unwrap().pending.len(),
         PREWARM_QUEUE_LIMIT
      );
   }

   #[test]
   fn evicts_the_least_recently_used_blame() {
      let cache = BlameCache::new(2);
      let key = |name: &str| BlameCacheKey {
         repo_dir: PathBuf::from("/repo"),
         file_path: name.to_string(),
         head: Oid::zero(),
         blob: Oid::zero(),
      };
      let blame = || {
         Arc::new(CommittedBlame {
            commits: Vec::new(),
            hunks: Vec::new(),
         })
      };

      cache.insert(key("a"), blame());
      cache.insert(key("b"), blame());
      assert!(cache.get(&key("a")).is_some());
      cache.insert(key("c"), blame());

      assert_eq!(cache.len(), 2);
      assert!(cache.get(&key("a")).is_some());
      assert!(cache.get(&key("b")).is_none());
      assert!(cache.get(&key("c")).is_some());
   }

   #[test]
   fn fails_for_a_file_missing_from_head() {
      let (temp_dir, repo) = init_repo();
      commit_file(&repo, "example.txt", "first\n", "Initial commit");

      assert!(git_blame_file(root(&temp_dir), "missing.txt", "first\n").is_err());
   }

   #[test]
   fn parses_author_header_without_name() {
      let author = parse_author_header(b"<missing@example.com> 1700000000 +0000");

      assert_eq!(author.name, "Unknown");
      assert_eq!(author.email, "missing@example.com");
      assert_eq!(author.time, 1_700_000_000);
   }
}
