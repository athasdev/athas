use lsp_types::SemanticToken;
use serde::Deserialize;
use std::{collections::HashMap, sync::Mutex};

/// The last full token set a server returned for a document, kept so the next request can ask
/// `textDocument/semanticTokens/full/delta` for only what changed since `result_id`. Stored as
/// the raw integer array because delta edits address single integers, not whole tokens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CachedSemanticTokens {
   pub client_id: String,
   /// The document session the tokens belong to; a reopened document starts a new one.
   pub epoch: u64,
   pub result_id: String,
   pub data: Vec<u32>,
}

/// Per-document semantic token results, keyed by file path.
#[derive(Default)]
pub(crate) struct SemanticTokenCache {
   entries: Mutex<HashMap<String, CachedSemanticTokens>>,
}

impl SemanticTokenCache {
   /// The cached result for `file_path` when it came from `client_id` in session `epoch`.
   pub fn get(&self, file_path: &str, client_id: &str, epoch: u64) -> Option<CachedSemanticTokens> {
      let entries = self.entries.lock().unwrap();
      entries
         .get(file_path)
         .filter(|entry| entry.client_id == client_id && entry.epoch == epoch)
         .cloned()
   }

   /// Remembers `data` when the server gave it a result id, otherwise forgets the document.
   pub fn store(
      &self,
      file_path: &str,
      client_id: &str,
      epoch: u64,
      result_id: Option<String>,
      data: Vec<u32>,
   ) {
      let mut entries = self.entries.lock().unwrap();
      match result_id {
         Some(result_id) => {
            entries.insert(
               file_path.to_string(),
               CachedSemanticTokens {
                  client_id: client_id.to_string(),
                  epoch,
                  result_id,
                  data,
               },
            );
         }
         None => {
            entries.remove(file_path);
         }
      }
   }

   pub fn remove(&self, file_path: &str) {
      self.entries.lock().unwrap().remove(file_path);
   }

   pub fn clear(&self) {
      self.entries.lock().unwrap().clear();
   }
}

/// One edit of a delta response, in integer offsets into the previous array. Kept raw because
/// servers may split edits inside a token, which `lsp_types` refuses to deserialize.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawSemanticTokensEdit {
   pub start: u32,
   pub delete_count: u32,
   #[serde(default)]
   pub data: Option<Vec<u32>>,
}

/// A `semanticTokens/full/delta` response: either new full tokens or edits.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum RawSemanticTokensDeltaResult {
   Tokens {
      #[serde(rename = "resultId", default)]
      result_id: Option<String>,
      data: Vec<u32>,
   },
   Delta {
      #[serde(rename = "resultId", default)]
      result_id: Option<String>,
      edits: Vec<RawSemanticTokensEdit>,
   },
}

/// Applies a server's integer-offset edits to the previous integer array. Returns `None` when
/// edits overlap, reach past the end, or leave an array that is not whole tokens, so the caller
/// can fall back to a full request instead of drawing corrupted tokens.
pub(crate) fn apply_semantic_token_edits(
   previous: &[u32],
   edits: &[RawSemanticTokensEdit],
) -> Option<Vec<u32>> {
   let mut ordered: Vec<&RawSemanticTokensEdit> = edits.iter().collect();
   ordered.sort_by_key(|edit| edit.start);

   let mut result = Vec::with_capacity(previous.len());
   let mut cursor = 0usize;
   for edit in ordered {
      let start = edit.start as usize;
      let end = start.checked_add(edit.delete_count as usize)?;
      if start < cursor || end > previous.len() {
         return None;
      }
      result.extend_from_slice(&previous[cursor..start]);
      if let Some(data) = &edit.data {
         result.extend_from_slice(data);
      }
      cursor = end;
   }
   result.extend_from_slice(&previous[cursor..]);
   (result.len() % 5 == 0).then_some(result)
}

/// The full integer array and its result id after a delta response, or `None` when the
/// response cannot be applied to `previous`.
pub(crate) fn resolve_semantic_tokens_delta(
   previous: &[u32],
   response: RawSemanticTokensDeltaResult,
) -> Option<(Option<String>, Vec<u32>)> {
   match response {
      RawSemanticTokensDeltaResult::Tokens { result_id, data } => {
         (data.len() % 5 == 0).then_some((result_id, data))
      }
      RawSemanticTokensDeltaResult::Delta { result_id, edits } => {
         apply_semantic_token_edits(previous, &edits).map(|data| (result_id, data))
      }
   }
}

pub(crate) fn flatten_semantic_tokens(tokens: &[SemanticToken]) -> Vec<u32> {
   let mut data = Vec::with_capacity(tokens.len() * 5);
   for token in tokens {
      data.extend_from_slice(&[
         token.delta_line,
         token.delta_start,
         token.length,
         token.token_type,
         token.token_modifiers_bitset,
      ]);
   }
   data
}

/// Groups a whole-token integer array back into tokens; the caller checked the length.
pub(crate) fn group_semantic_tokens(data: &[u32]) -> Vec<SemanticToken> {
   data
      .as_chunks::<5>()
      .0
      .iter()
      .map(
         |&[
            delta_line,
            delta_start,
            length,
            token_type,
            token_modifiers_bitset,
         ]| SemanticToken {
            delta_line,
            delta_start,
            length,
            token_type,
            token_modifiers_bitset,
         },
      )
      .collect()
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   fn edit(start: u32, delete_count: u32, data: Option<&[u32]>) -> RawSemanticTokensEdit {
      RawSemanticTokensEdit {
         start,
         delete_count,
         data: data.map(<[u32]>::to_vec),
      }
   }

   #[test]
   fn applies_insertions_deletions_and_replacements() {
      let previous: Vec<u32> = (0..25).collect();
      let result = apply_semantic_token_edits(
         &previous,
         &[
            edit(20, 5, Some(&[40, 41, 42, 43, 44, 45, 46, 47, 48, 49])),
            edit(0, 0, Some(&[9, 9, 9, 9, 9])),
            edit(5, 10, None),
         ],
      )
      .unwrap();
      let mut expected = vec![9, 9, 9, 9, 9, 0, 1, 2, 3, 4, 15, 16, 17, 18, 19];
      expected.extend(40..50);
      assert_eq!(result, expected);
   }

   #[test]
   fn applies_edits_that_split_tokens() {
      // The shape vscode-languageserver-node produces: only the changed integers are replaced.
      let previous = vec![0, 4, 3, 1, 0, 1, 2, 5, 2, 0];
      let result = apply_semantic_token_edits(&previous, &[edit(6, 2, Some(&[3, 6]))]).unwrap();
      assert_eq!(result, vec![0, 4, 3, 1, 0, 1, 3, 6, 2, 0]);

      let response: RawSemanticTokensDeltaResult = serde_json::from_value(json!({
         "resultId": "7",
         "edits": [{ "start": 1, "deleteCount": 1, "data": [8] }]
      }))
      .unwrap();
      assert_eq!(
         resolve_semantic_tokens_delta(&previous, response),
         Some((Some("7".into()), vec![0, 8, 3, 1, 0, 1, 2, 5, 2, 0]))
      );
   }

   #[test]
   fn rejects_overlapping_out_of_range_or_partial_results() {
      let previous: Vec<u32> = (0..15).collect();
      assert!(apply_semantic_token_edits(&previous, &[edit(10, 10, None)]).is_none());
      assert!(
         apply_semantic_token_edits(&previous, &[edit(0, 10, None), edit(5, 5, None)]).is_none()
      );
      assert!(apply_semantic_token_edits(&previous, &[edit(3, 1, None)]).is_none());
   }

   #[test]
   fn resolves_full_responses_and_round_trips_tokens() {
      let response: RawSemanticTokensDeltaResult =
         serde_json::from_value(json!({ "resultId": "2", "data": [0, 1, 2, 3, 4] })).unwrap();
      let (result_id, data) = resolve_semantic_tokens_delta(&[], response).unwrap();
      assert_eq!(result_id.as_deref(), Some("2"));
      assert_eq!(flatten_semantic_tokens(&group_semantic_tokens(&data)), data);
   }

   #[test]
   fn cache_is_scoped_to_the_client_and_document_session() {
      let cache = SemanticTokenCache::default();
      cache.store("/a.rs", "client-1", 1, Some("1".into()), vec![1]);
      assert_eq!(cache.get("/a.rs", "client-1", 1).unwrap().result_id, "1");
      assert!(cache.get("/a.rs", "client-2", 1).is_none());
      assert!(cache.get("/a.rs", "client-1", 2).is_none());

      cache.store("/a.rs", "client-1", 1, None, vec![1]);
      assert!(cache.get("/a.rs", "client-1", 1).is_none());

      cache.store("/a.rs", "client-1", 1, Some("2".into()), vec![1]);
      cache.remove("/a.rs");
      assert!(cache.get("/a.rs", "client-1", 1).is_none());

      cache.store("/b.rs", "client-1", 1, Some("3".into()), vec![1]);
      cache.clear();
      assert!(cache.get("/b.rs", "client-1", 1).is_none());
   }
}
