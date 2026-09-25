//! Helpers behind the ACP `fs/*` methods that do not need the client's state.

use agent_client_protocol::schema::v1 as acp;
use std::{io, path::Path};

/// The ACP error for a failed read. A missing file is `resource_not_found` (-32002), so agents can
/// tell it apart from a real failure; anything else is an internal error.
pub(super) fn read_error(path: &Path, error: &io::Error) -> acp::Error {
   if error.kind() == io::ErrorKind::NotFound {
      return acp::Error::resource_not_found(Some(path.display().to_string()));
   }
   acp::Error::new(-32603, format!("Failed to read file: {error}"))
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

   #[test]
   fn other_read_failures_stay_internal_errors() {
      let error = read_error(
         Path::new("/repo/locked.txt"),
         &io::Error::from(io::ErrorKind::PermissionDenied),
      );

      assert_eq!(serde_json::to_value(error).unwrap()["code"], -32603);
   }
}
