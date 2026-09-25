//! Helpers behind the ACP `fs/*` methods that do not need the client's state.

use super::{
   client::PermissionResponse,
   types::{AcpPermissionOption, AcpPermissionOptionKind, AcpPermissionToolCall, AcpToolKind},
   workspace_path::path_to_string,
};
use agent_client_protocol::schema::v1 as acp;
use serde::Serialize;
use std::{io, path::Path};

/// What an agent wants to do with a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FileAccess {
   Read,
   Write,
}

/// The user's answer to an agent touching a file outside the workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OutsideAccess {
   Once,
   /// Reads in the same folder go ahead without asking again for the rest of the session.
   FolderForSession,
   Denied,
   Cancelled,
}

const ALLOW_ONCE: &str = "allow_once";
const ALLOW_FOLDER: &str = "allow_folder_for_session";
const DENY: &str = "deny";

/// The choices an outside-the-workspace prompt offers. Only reads can be allowed for the session;
/// every write outside the workspace is asked about on its own.
pub(super) fn outside_access_options(access: FileAccess) -> Vec<AcpPermissionOption> {
   let mut options = vec![AcpPermissionOption {
      id: ALLOW_ONCE.to_string(),
      name: "Allow once".to_string(),
      kind: AcpPermissionOptionKind::AllowOnce,
   }];
   if access == FileAccess::Read {
      options.push(AcpPermissionOption {
         id: ALLOW_FOLDER.to_string(),
         name: "Allow reads in this folder for this session".to_string(),
         kind: AcpPermissionOptionKind::AllowAlways,
      });
   }
   options.push(AcpPermissionOption {
      id: DENY.to_string(),
      name: "Deny".to_string(),
      kind: AcpPermissionOptionKind::RejectOnce,
   });
   options
}

/// Reads the frontend's answer. No answer (timed out, or the agent went away) denies, and a write
/// is never allowed beyond this once, whatever option comes back.
pub(super) fn outside_access_answer(
   access: FileAccess,
   response: Option<&PermissionResponse>,
) -> OutsideAccess {
   let Some(response) = response else {
      return OutsideAccess::Denied;
   };
   if response.cancelled {
      return OutsideAccess::Cancelled;
   }
   match response.option_id.as_deref() {
      Some(ALLOW_ONCE) => OutsideAccess::Once,
      Some(ALLOW_FOLDER) if access == FileAccess::Read => OutsideAccess::FolderForSession,
      Some(ALLOW_FOLDER) => OutsideAccess::Once,
      Some(_) => OutsideAccess::Denied,
      None if response.approved => OutsideAccess::Once,
      None => OutsideAccess::Denied,
   }
}

/// What the permission prompt shows about the access: the path, why it asks, and for a write the
/// change as a diff (`old_text` is `None` for a new file).
pub(super) fn outside_access_tool_call(
   request_id: &str,
   access: FileAccess,
   path: &Path,
   old_text: Option<String>,
   new_text: Option<&str>,
) -> AcpPermissionToolCall {
   let shown_path = path_to_string(path);
   let (title, kind, reason) = match access {
      FileAccess::Read => (
         format!("Read {shown_path}"),
         AcpToolKind::Read,
         "The agent wants to read a file outside the workspace. Always lets it read other files \
          in the same folder for the rest of this session.",
      ),
      FileAccess::Write => (
         format!("Write {shown_path}"),
         AcpToolKind::Edit,
         "The agent wants to write a file outside the workspace.",
      ),
   };
   let mut content = vec![acp::ToolCallContent::from(reason)];
   if let Some(new_text) = new_text {
      content.push(acp::Diff::new(path, new_text).old_text(old_text).into());
   }
   AcpPermissionToolCall {
      tool_id: request_id.to_string(),
      title: Some(title),
      kind: Some(kind),
      content: serde_json::to_value(content).ok(),
      locations: Some(vec![super::types::AcpToolCallLocation {
         path: shown_path,
         line: None,
      }]),
      raw_input: None,
   }
}

/// The error for an access the user did not allow.
pub(super) fn access_denied(path: &Path) -> acp::Error {
   acp::Error::new(
      -32603,
      format!(
         "The user did not allow access to {}, which is outside the workspace",
         path.display()
      ),
   )
   .data(serde_json::json!({ "uri": path_to_string(path) }))
}

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

/// What a file held before an agent wrote it, kept so the write can be reviewed afterwards.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PriorContent {
   /// The write creates the file.
   Missing,
   Text(String),
   /// The file existed but could not be read as text, so the write cannot be reviewed.
   Unreadable,
}

impl PriorContent {
   pub fn from_read(read: io::Result<Vec<u8>>) -> Self {
      match read {
         Ok(bytes) => String::from_utf8(bytes).map_or(Self::Unreadable, Self::Text),
         Err(error) if error.kind() == io::ErrorKind::NotFound => Self::Missing,
         Err(_) => Self::Unreadable,
      }
   }

   pub fn existed(&self) -> bool {
      !matches!(self, Self::Missing)
   }
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
   fn prior_content_tells_new_text_and_unreadable_files_apart() {
      assert_eq!(
         PriorContent::from_read(Err(io::Error::from(io::ErrorKind::NotFound))),
         PriorContent::Missing
      );
      assert_eq!(
         PriorContent::from_read(Ok(b"fn main() {}\n".to_vec())),
         PriorContent::Text("fn main() {}\n".to_string())
      );
      assert_eq!(
         PriorContent::from_read(Ok(vec![0xff, 0xfe, 0x00])),
         PriorContent::Unreadable
      );
      let denied = PriorContent::from_read(Err(io::Error::from(io::ErrorKind::PermissionDenied)));
      assert_eq!(denied, PriorContent::Unreadable);
      assert!(denied.existed());
      assert!(!PriorContent::Missing.existed());
   }

   fn answer(approved: bool, cancelled: bool, option_id: Option<&str>) -> PermissionResponse {
      PermissionResponse {
         approved,
         cancelled,
         option_id: option_id.map(str::to_string),
      }
   }

   #[test]
   fn only_reads_can_be_allowed_for_the_session() {
      let ids = |access| {
         outside_access_options(access)
            .into_iter()
            .map(|option| option.id)
            .collect::<Vec<_>>()
      };
      assert_eq!(
         ids(FileAccess::Read),
         ["allow_once", "allow_folder_for_session", "deny"]
      );
      assert_eq!(ids(FileAccess::Write), ["allow_once", "deny"]);

      let folder = answer(true, false, Some("allow_folder_for_session"));
      assert_eq!(
         outside_access_answer(FileAccess::Read, Some(&folder)),
         OutsideAccess::FolderForSession
      );
      // A write never gets more than this one time, whatever comes back.
      assert_eq!(
         outside_access_answer(FileAccess::Write, Some(&folder)),
         OutsideAccess::Once
      );
   }

   #[test]
   fn reads_the_users_answer() {
      let read = FileAccess::Read;
      assert_eq!(
         outside_access_answer(read, Some(&answer(true, false, Some("allow_once")))),
         OutsideAccess::Once
      );
      assert_eq!(
         outside_access_answer(read, Some(&answer(false, false, Some("deny")))),
         OutsideAccess::Denied
      );
      assert_eq!(
         outside_access_answer(read, Some(&answer(true, false, Some("unknown")))),
         OutsideAccess::Denied
      );
      assert_eq!(
         outside_access_answer(read, Some(&answer(true, false, None))),
         OutsideAccess::Once
      );
      assert_eq!(
         outside_access_answer(read, Some(&answer(false, false, None))),
         OutsideAccess::Denied
      );
      assert_eq!(
         outside_access_answer(read, Some(&answer(false, true, None))),
         OutsideAccess::Cancelled
      );
      assert_eq!(outside_access_answer(read, None), OutsideAccess::Denied);
   }

   #[test]
   fn write_prompts_show_the_change() {
      let tool_call = outside_access_tool_call(
         "req-1",
         FileAccess::Write,
         Path::new("/outside/a.txt"),
         Some("old".to_string()),
         Some("new"),
      );
      let tool_call = serde_json::to_value(tool_call).unwrap();

      assert_eq!(tool_call["toolId"], "req-1");
      assert_eq!(tool_call["kind"], "edit");
      assert_eq!(tool_call["title"], "Write /outside/a.txt");
      assert_eq!(tool_call["content"][0]["type"], "content");
      assert_eq!(tool_call["content"][1]["type"], "diff");
      assert_eq!(tool_call["content"][1]["oldText"], "old");
      assert_eq!(tool_call["content"][1]["newText"], "new");
      assert_eq!(tool_call["locations"][0]["path"], "/outside/a.txt");

      let read = outside_access_tool_call(
         "req-2",
         FileAccess::Read,
         Path::new("/outside/a.txt"),
         None,
         None,
      );
      let read = serde_json::to_value(read).unwrap();
      assert_eq!(read["kind"], "read");
      assert_eq!(read["content"].as_array().unwrap().len(), 1);
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
