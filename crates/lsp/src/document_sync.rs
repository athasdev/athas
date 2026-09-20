use anyhow::{Context, Result, bail};
use lsp_types::{Position, Range, TextDocumentContentChangeEvent};
use serde::{Deserialize, Serialize};
use std::{
   collections::{HashMap, HashSet},
   sync::{
      Arc, Mutex,
      atomic::{AtomicU64, Ordering},
   },
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChange {
   pub range_offset: usize,
   pub range_length: usize,
   pub text: String,
   pub start_line: u32,
   pub start_column: u32,
   pub end_line: u32,
   pub end_column: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChangeBatch {
   pub model_session_id: String,
   pub model_version_id: i64,
   #[serde(default)]
   pub changes: Vec<DocumentChange>,
   #[serde(default)]
   pub is_eol_change: bool,
   #[serde(default)]
   pub is_flush: bool,
   pub full_content: Option<String>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum SyncMode {
   None,
   Full,
   Incremental,
}

#[derive(Debug, Clone)]
struct DocumentSession {
   content: String,
   line_starts: Vec<usize>,
   model_session_id: Option<String>,
   retired_model_sessions: HashSet<String>,
   model_version_id: i64,
   lsp_version: i32,
   pending_changes: Vec<TextDocumentContentChangeEvent>,
   generation: u64,
   sync_mode: SyncMode,
   epoch: u64,
   emission_lock: Arc<Mutex<()>>,
}

pub(crate) struct PendingDocumentChanges {
   pub version: i32,
   pub changes: Vec<TextDocumentContentChangeEvent>,
}

#[derive(Clone)]
pub(crate) struct DocumentSessions {
   inner: Arc<Mutex<HashMap<String, DocumentSession>>>,
   next_epoch: Arc<AtomicU64>,
}

impl Default for DocumentSessions {
   fn default() -> Self {
      Self {
         inner: Arc::new(Mutex::new(HashMap::new())),
         next_epoch: Arc::new(AtomicU64::new(1)),
      }
   }
}

impl DocumentSessions {
   pub fn open(&self, file_path: &str, content: String, sync_mode: SyncMode) {
      let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);
      let line_starts = collect_line_starts(&content);
      self.inner.lock().unwrap().insert(
         file_path.to_string(),
         DocumentSession {
            content,
            line_starts,
            model_session_id: None,
            retired_model_sessions: HashSet::new(),
            model_version_id: 0,
            lsp_version: 1,
            pending_changes: Vec::new(),
            generation: 0,
            sync_mode,
            epoch,
            emission_lock: Arc::new(Mutex::new(())),
         },
      );
   }

   pub fn close(&self, file_path: &str) {
      self.inner.lock().unwrap().remove(file_path);
   }

   #[cfg(test)]
   pub fn queue(&self, file_path: &str, batch: DocumentChangeBatch) -> Result<(u64, u64, i32)> {
      self.queue_many(file_path, vec![batch])
   }

   pub fn queue_many(
      &self,
      file_path: &str,
      batches: Vec<DocumentChangeBatch>,
   ) -> Result<(u64, u64, i32)> {
      let mut sessions = self.inner.lock().unwrap();
      let session = sessions
         .get_mut(file_path)
         .context("No open LSP document session for this file")?;
      let mut staged = session.clone();
      for batch in batches {
         apply_batch(&mut staged, batch)?;
      }
      let result = (
         staged.epoch,
         staged.generation,
         staged.lsp_version.saturating_add(1),
      );
      *session = staged;
      Ok(result)
   }

   #[cfg(test)]
   pub fn flush(&self, file_path: &str) -> Option<PendingDocumentChanges> {
      let mut sessions = self.inner.lock().unwrap();
      let session = sessions.get_mut(file_path)?;
      take_pending(session)
   }

   pub fn emit_pending(
      &self,
      file_path: &str,
      expected: Option<(u64, u64)>,
      emit: impl FnOnce(&PendingDocumentChanges) -> Result<()>,
   ) -> Result<()> {
      let (epoch, emission_lock) = {
         let sessions = self.inner.lock().unwrap();
         let Some(session) = sessions.get(file_path) else {
            return Ok(());
         };
         (session.epoch, Arc::clone(&session.emission_lock))
      };
      let _emission_guard = emission_lock.lock().unwrap();
      let pending = {
         let mut sessions = self.inner.lock().unwrap();
         let Some(session) = sessions.get_mut(file_path) else {
            return Ok(());
         };
         if session.epoch != epoch
            || expected.is_some_and(|(expected_epoch, generation)| {
               expected_epoch != session.epoch || generation != session.generation
            })
         {
            return Ok(());
         }
         take_pending(session)
      };
      if let Some(pending) = pending
         && let Err(error) = emit(&pending)
      {
         let mut sessions = self.inner.lock().unwrap();
         if let Some(session) = sessions.get_mut(file_path)
            && session.epoch == epoch
         {
            session.lsp_version = pending.version.saturating_sub(1);
            if !session
               .pending_changes
               .iter()
               .any(|change| change.range.is_none())
            {
               let mut restored = pending.changes;
               restored.append(&mut session.pending_changes);
               session.pending_changes = restored;
            }
         }
         return Err(error);
      }
      Ok(())
   }

   pub fn content(&self, file_path: &str) -> Option<String> {
      self
         .inner
         .lock()
         .unwrap()
         .get(file_path)
         .map(|session| session.content.clone())
   }
}

fn apply_batch(session: &mut DocumentSession, batch: DocumentChangeBatch) -> Result<()> {
   let replacement = batch.is_flush || batch.is_eol_change;
   if !replacement
      && session.model_session_id.as_deref() == Some(&batch.model_session_id)
      && batch.model_version_id <= session.model_version_id
   {
      bail!("Stale LSP document change batch");
   }
   if !replacement
      && session
         .retired_model_sessions
         .contains(&batch.model_session_id)
   {
      bail!("Change belongs to a retired LSP model session");
   }

   let mut next_content = session.content.clone();
   let mut next_line_starts = session.line_starts.clone();
   let mut next_pending = session.pending_changes.clone();
   if replacement {
      next_content = batch
         .full_content
         .context("Full document content is required for replacement changes")?;
      next_line_starts = collect_line_starts(&next_content);
      next_pending.clear();
      next_pending.push(TextDocumentContentChangeEvent {
         range: None,
         range_length: None,
         text: next_content.clone(),
      });
   } else {
      if batch.changes.is_empty() {
         bail!("Incremental document change batch is empty");
      }

      let mut changes = batch.changes;
      // Monaco ranges within one event refer to the same pre-edit document. Applying
      // them from the end keeps every earlier UTF-16 offset and position valid.
      changes.sort_by_key(|change| std::cmp::Reverse(change.range_offset));
      for pair in changes.windows(2) {
         if pair[1].range_offset.saturating_add(pair[1].range_length) > pair[0].range_offset {
            bail!("Overlapping changes in one Monaco event are invalid");
         }
      }
      for change in changes {
         apply_change(&mut next_content, &mut next_line_starts, &change)?;
         next_pending.push(TextDocumentContentChangeEvent {
            range: Some(Range {
               start: Position {
                  line: change.start_line,
                  character: change.start_column,
               },
               end: Position {
                  line: change.end_line,
                  character: change.end_column,
               },
            }),
            range_length: Some(change.range_length as u32),
            text: change.text,
         });
      }
   }

   if !replacement {
      if let Some(previous_session) = session.model_session_id.replace(batch.model_session_id)
         && session.model_session_id.as_deref() != Some(&previous_session)
      {
         session.retired_model_sessions.insert(previous_session);
      }
      session.model_version_id = batch.model_version_id;
   }
   session.content = next_content;
   session.line_starts = next_line_starts;
   session.pending_changes = next_pending;
   session.generation = session.generation.wrapping_add(1);
   Ok(())
}

fn take_pending(session: &mut DocumentSession) -> Option<PendingDocumentChanges> {
   if session.pending_changes.is_empty() || session.sync_mode == SyncMode::None {
      session.pending_changes.clear();
      return None;
   }

   session.lsp_version = session.lsp_version.saturating_add(1);
   let changes = if session.sync_mode == SyncMode::Incremental
      && session
         .pending_changes
         .iter()
         .all(|change| change.range.is_some())
   {
      std::mem::take(&mut session.pending_changes)
   } else {
      session.pending_changes.clear();
      vec![TextDocumentContentChangeEvent {
         range: None,
         range_length: None,
         text: session.content.clone(),
      }]
   };
   Some(PendingDocumentChanges {
      version: session.lsp_version,
      changes,
   })
}

fn collect_line_starts(content: &str) -> Vec<usize> {
   std::iter::once(0)
      .chain(
         content
            .match_indices('\n')
            .map(|(byte_offset, _)| byte_offset + 1),
      )
      .collect()
}

fn position_to_byte(content: &str, line_starts: &[usize], line: u32, column: u32) -> Option<usize> {
   let line_start = *line_starts.get(line as usize)?;
   let line_end = line_starts
      .get(line as usize + 1)
      .copied()
      .unwrap_or(content.len());
   let mut utf16_column = 0;
   for (relative_byte, character) in content[line_start..line_end].char_indices() {
      if utf16_column == column {
         return Some(line_start + relative_byte);
      }
      utf16_column += character.len_utf16() as u32;
      if utf16_column > column || character == '\n' {
         return None;
      }
   }
   (utf16_column == column).then_some(line_end)
}

fn apply_change(
   content: &mut String,
   line_starts: &mut Vec<usize>,
   change: &DocumentChange,
) -> Result<()> {
   let start = position_to_byte(content, line_starts, change.start_line, change.start_column)
      .context("LSP change starts at an invalid UTF-16 position")?;
   let end = position_to_byte(content, line_starts, change.end_line, change.end_column)
      .context("LSP change ends at an invalid UTF-16 position")?;
   if end < start {
      bail!("LSP change range ends before it starts");
   }
   let removed_byte_length = end - start;
   content.replace_range(start..end, &change.text);

   let first_removed_line = change.start_line as usize + 1;
   let removed_line_end = change.end_line as usize + 1;
   line_starts.drain(first_removed_line..removed_line_end);
   let inserted_line_starts: Vec<usize> = change
      .text
      .match_indices('\n')
      .map(|(offset, _)| start + offset + 1)
      .collect();
   let inserted_line_count = inserted_line_starts.len();
   line_starts.splice(first_removed_line..first_removed_line, inserted_line_starts);
   let byte_delta = change.text.len() as isize - removed_byte_length as isize;
   for line_start in line_starts
      .iter_mut()
      .skip(first_removed_line + inserted_line_count)
   {
      *line_start = line_start.saturating_add_signed(byte_delta);
   }
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   fn change(
      offset: usize,
      length: usize,
      text: &str,
      range: (u32, u32, u32, u32),
   ) -> DocumentChange {
      DocumentChange {
         range_offset: offset,
         range_length: length,
         text: text.to_string(),
         start_line: range.0,
         start_column: range.1,
         end_line: range.2,
         end_column: range.3,
      }
   }

   fn batch(version: i64, changes: Vec<DocumentChange>) -> DocumentChangeBatch {
      DocumentChangeBatch {
         model_session_id: "model-a".to_string(),
         model_version_id: version,
         changes,
         is_eol_change: false,
         is_flush: false,
         full_content: None,
      }
   }

   #[test]
   fn applies_unicode_offsets_as_utf16_code_units() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "a😀b".to_string(), SyncMode::Incremental);
      sessions
         .queue("/test.ts", batch(2, vec![change(1, 2, "x", (0, 1, 0, 3))]))
         .unwrap();

      assert_eq!(sessions.content("/test.ts").as_deref(), Some("axb"));
      let pending = sessions.flush("/test.ts").unwrap();
      assert_eq!(pending.version, 2);
      assert_eq!(pending.changes[0].range.unwrap().end.character, 3);
   }

   #[test]
   fn applies_multiple_monaco_changes_from_highest_offset_first() {
      let sessions = DocumentSessions::default();
      sessions.open(
         "/test.ts",
         "one\r\ntwo\r\nthree".to_string(),
         SyncMode::Incremental,
      );
      sessions
         .queue(
            "/test.ts",
            batch(
               2,
               vec![
                  change(0, 3, "1", (0, 0, 0, 3)),
                  change(10, 5, "3", (2, 0, 2, 5)),
               ],
            ),
         )
         .unwrap();

      assert_eq!(
         sessions.content("/test.ts").as_deref(),
         Some("1\r\ntwo\r\n3")
      );
      let pending = sessions.flush("/test.ts").unwrap();
      assert_eq!(pending.changes.len(), 2);
      assert_eq!(pending.changes[0].range.unwrap().start.line, 2);
      assert_eq!(pending.changes[1].range.unwrap().start.line, 0);
   }

   #[test]
   fn full_sync_servers_receive_one_final_replacement() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "abc".to_string(), SyncMode::Full);
      sessions
         .queue("/test.ts", batch(2, vec![change(3, 0, "d", (0, 3, 0, 3))]))
         .unwrap();
      sessions
         .queue("/test.ts", batch(3, vec![change(4, 0, "e", (0, 4, 0, 4))]))
         .unwrap();

      let pending = sessions.flush("/test.ts").unwrap();
      assert_eq!(pending.version, 2);
      assert_eq!(pending.changes.len(), 1);
      assert!(pending.changes[0].range.is_none());
      assert_eq!(pending.changes[0].text, "abcde");
   }

   #[test]
   fn replacement_supersedes_queued_incremental_changes() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "abc".to_string(), SyncMode::Incremental);
      sessions
         .queue("/test.ts", batch(2, vec![change(3, 0, "d", (0, 3, 0, 3))]))
         .unwrap();
      let mut replacement = batch(3, Vec::new());
      replacement.model_session_id = "buffer-store".to_string();
      replacement.is_flush = true;
      replacement.full_content = Some("formatted\r\ntext".to_string());
      sessions.queue("/test.ts", replacement).unwrap();

      let pending = sessions.flush("/test.ts").unwrap();
      assert_eq!(pending.changes.len(), 1);
      assert!(pending.changes[0].range.is_none());
      assert_eq!(pending.changes[0].text, "formatted\r\ntext");
      assert!(
         sessions
            .queue("/test.ts", batch(4, vec![change(15, 0, "!", (1, 4, 1, 4))]))
            .is_ok()
      );
   }

   #[test]
   fn rejects_stale_versions_within_a_model_session() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "abc".to_string(), SyncMode::Incremental);
      sessions
         .queue("/test.ts", batch(3, vec![change(3, 0, "d", (0, 3, 0, 3))]))
         .unwrap();
      assert!(
         sessions
            .queue("/test.ts", batch(2, vec![change(0, 0, "x", (0, 0, 0, 0))]))
            .is_err()
      );
   }

   #[test]
   fn invalid_batch_does_not_partially_mutate_the_session() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "abc".to_string(), SyncMode::Incremental);
      let result = sessions.queue(
         "/test.ts",
         batch(
            2,
            vec![
               change(2, 1, "x", (0, 2, 0, 3)),
               change(0, 1, "y", (9, 0, 9, 1)),
            ],
         ),
      );

      assert!(result.is_err());
      assert_eq!(sessions.content("/test.ts").as_deref(), Some("abc"));
      assert!(sessions.flush("/test.ts").is_none());
   }

   #[test]
   fn invalid_ipc_batch_does_not_commit_earlier_event_batches() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "abc".to_string(), SyncMode::Incremental);
      let result = sessions.queue_many(
         "/test.ts",
         vec![
            batch(2, vec![change(3, 0, "d", (0, 3, 0, 3))]),
            batch(3, vec![change(0, 1, "x", (4, 0, 4, 1))]),
         ],
      );

      assert!(result.is_err());
      assert_eq!(sessions.content("/test.ts").as_deref(), Some("abc"));
      assert!(sessions.flush("/test.ts").is_none());
   }

   #[test]
   fn stale_debounce_epoch_cannot_flush_a_reopened_document() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "old".to_string(), SyncMode::Incremental);
      let (old_epoch, old_generation, _) = sessions
         .queue("/test.ts", batch(2, vec![change(3, 0, "!", (0, 3, 0, 3))]))
         .unwrap();
      sessions.close("/test.ts");
      sessions.open("/test.ts", "new".to_string(), SyncMode::Incremental);
      sessions
         .queue("/test.ts", batch(2, vec![change(3, 0, "!", (0, 3, 0, 3))]))
         .unwrap();

      let mut emitted = false;
      sessions
         .emit_pending("/test.ts", Some((old_epoch, old_generation)), |_| {
            emitted = true;
            Ok(())
         })
         .unwrap();
      assert!(!emitted);
      assert!(sessions.flush("/test.ts").is_some());
   }

   #[test]
   fn failed_emission_restores_pending_changes_and_version() {
      let sessions = DocumentSessions::default();
      sessions.open("/test.ts", "abc".to_string(), SyncMode::Incremental);
      sessions
         .queue("/test.ts", batch(2, vec![change(3, 0, "d", (0, 3, 0, 3))]))
         .unwrap();

      assert!(
         sessions
            .emit_pending("/test.ts", None, |_| bail!("send failed"))
            .is_err()
      );
      let pending = sessions.flush("/test.ts").unwrap();
      assert_eq!(pending.version, 2);
      assert_eq!(pending.changes[0].text, "d");
   }
}
