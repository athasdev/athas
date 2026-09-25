//! Helpers behind the ACP `fs/*` methods that do not need the client's state.

use agent_client_protocol::schema::v1 as acp;
use serde::Serialize;
use std::{io, path::Path};

/// The `file-changed` event payload, in the shape the project file watcher emits and the
/// frontend's file watcher listener reads.
#[derive(Debug, Clone, Serialize)]
pub(super) struct FileChangeEvent {
   pub path: String,
   pub event_type: FileChangeType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum FileChangeType {
   /// A file that did not exist before: its folder in the file tree refreshes.
   Opened,
   /// An existing file changed: an open editor for it reloads.
   Reloaded,
}

/// The ACP error for a failed read. A missing file is `resource_not_found` (-32002), so agents can
/// tell it apart from a real failure; anything else is an internal error.
pub(super) fn read_error(path: &Path, error: &io::Error) -> acp::Error {
   if error.kind() == io::ErrorKind::NotFound {
      return acp::Error::resource_not_found(Some(path.display().to_string()));
   }
   acp::Error::new(-32603, format!("Failed to read file: {error}"))
}

/// The part of `content` an `fs/read_text_file` request asks for: `limit` lines starting at the
/// 1-based `line`. Lines keep their own endings, so a slice reads exactly as the file does. A start
/// past the last line is invalid params, as in Zed.
pub(super) fn slice_lines(
   content: String,
   line: Option<u32>,
   limit: Option<u32>,
) -> Result<String, acp::Error> {
   if line.is_none() && limit.is_none() {
      return Ok(content);
   }
   let start = line.unwrap_or(1).saturating_sub(1) as usize;
   let limit = limit.map_or(usize::MAX, |limit| limit as usize);
   let line_count = content.matches('\n').count() + 1;
   if start >= line_count {
      return Err(acp::Error::invalid_params().data(format!(
         "Line {} is past the end of the file, which has {line_count} lines",
         start + 1
      )));
   }
   Ok(content
      .split_inclusive('\n')
      .skip(start)
      .take(limit)
      .collect())
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   #[test]
   fn missing_files_are_resource_not_found() {
      let error = read_error(
         Path::new("/repo/missing.txt"),
         &io::Error::from(io::ErrorKind::NotFound),
      );
      let error = serde_json::to_value(error).unwrap();

      assert_eq!(error["code"], -32002);
      assert_eq!(error["data"], json!({ "uri": "/repo/missing.txt" }));
   }

   fn slice(content: &str, line: Option<u32>, limit: Option<u32>) -> String {
      slice_lines(content.to_string(), line, limit).unwrap()
   }

   #[test]
   fn slices_from_a_one_based_line() {
      let content = "one\ntwo\nthree\nfour\n";

      assert_eq!(slice(content, None, None), content);
      assert_eq!(slice(content, Some(1), Some(1)), "one\n");
      assert_eq!(slice(content, Some(2), Some(2)), "two\nthree\n");
      assert_eq!(slice(content, Some(3), None), "three\nfour\n");
      assert_eq!(slice(content, None, Some(2)), "one\ntwo\n");
      assert_eq!(slice(content, Some(4), Some(10)), "four\n");
      assert_eq!(slice(content, Some(2), Some(0)), "");
      // Line 0 is not valid ACP; it reads from the start rather than failing.
      assert_eq!(slice(content, Some(0), Some(1)), "one\n");
   }

   #[test]
   fn slices_keep_line_endings() {
      assert_eq!(slice("a\r\nb\r\nc", Some(2), Some(1)), "b\r\n");
      assert_eq!(slice("a\nb", Some(2), None), "b");
   }

   #[test]
   fn reading_past_the_end_is_invalid_params() {
      // The empty line after a trailing newline can still be read.
      assert_eq!(slice("a\n", Some(2), None), "");

      let error = slice_lines("a\n".to_string(), Some(3), None).unwrap_err();
      assert_eq!(serde_json::to_value(error).unwrap()["code"], -32602);
   }

   #[test]
   fn file_change_events_match_the_file_watcher_payload() {
      let event = FileChangeEvent {
         path: "/repo/a.txt".to_string(),
         event_type: FileChangeType::Reloaded,
      };
      assert_eq!(
         serde_json::to_value(event).unwrap(),
         json!({ "path": "/repo/a.txt", "event_type": "reloaded" })
      );

      let created = FileChangeEvent {
         path: "/repo/b.txt".to_string(),
         event_type: FileChangeType::Opened,
      };
      assert_eq!(
         serde_json::to_value(created).unwrap()["event_type"],
         "opened"
      );
   }

   #[test]
   fn other_read_failures_stay_internal_errors() {
      let error = read_error(
         Path::new("/repo/locked.txt"),
         &io::Error::from(io::ErrorKind::PermissionDenied),
      );

      assert_eq!(serde_json::to_value(error).unwrap()["code"], -32603);
   }
}
