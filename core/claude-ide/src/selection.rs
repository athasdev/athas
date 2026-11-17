use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// A zero-based position, as Claude Code expects in selection payloads.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub struct SelectionPosition {
   pub line: u32,
   pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorSelection {
   pub file_path: String,
   pub text: String,
   pub start: SelectionPosition,
   pub end: SelectionPosition,
}

impl EditorSelection {
   pub fn is_empty(&self) -> bool {
      self.start == self.end
   }

   /// The `selection_changed` params, which are also what the selection tools return.
   pub fn to_protocol(&self) -> Value {
      json!({
         "text": self.text,
         "filePath": self.file_path,
         "fileUrl": file_url(&self.file_path),
         "selection": {
            "start": self.start,
            "end": self.end,
            "isEmpty": self.is_empty(),
         },
      })
   }
}

pub fn file_url(path: &str) -> String {
   let mut url = String::from("file://");
   if !path.starts_with('/') {
      url.push('/');
   }
   for byte in path.replace('\\', "/").bytes() {
      match byte {
         b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' | b':' => {
            url.push(byte as char)
         }
         _ => url.push_str(&format!("%{byte:02X}")),
      }
   }
   url
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn protocol_shape_matches_selection_changed() {
      let selection = EditorSelection {
         file_path: "/work/app/main.rs".to_string(),
         text: "fn main".to_string(),
         start: SelectionPosition {
            line: 0,
            character: 0,
         },
         end: SelectionPosition {
            line: 0,
            character: 7,
         },
      };
      assert_eq!(
         selection.to_protocol(),
         json!({
            "text": "fn main",
            "filePath": "/work/app/main.rs",
            "fileUrl": "file:///work/app/main.rs",
            "selection": {
               "start": { "line": 0, "character": 0 },
               "end": { "line": 0, "character": 7 },
               "isEmpty": false,
            },
         })
      );
   }

   #[test]
   fn file_urls_escape_unsafe_characters() {
      assert_eq!(file_url("/a b/c#d.rs"), "file:///a%20b/c%23d.rs");
      assert_eq!(file_url("C:\\work\\x.rs"), "file:///C:/work/x.rs");
   }
}
