use super::cli_args::CliRequest;
use crate::commands::ui::window::CreateAppWindowRequest;
use serde_json::json;

pub fn requests_need_workbench(requests: &[CliRequest]) -> bool {
   requests.is_empty()
      || requests
         .iter()
         .any(|request| !matches!(request, CliRequest::NewWindow { .. }))
}

pub fn window_request(request: CliRequest) -> CreateAppWindowRequest {
   match request {
      CliRequest::NewWindow { request } => window_request(*request),
      CliRequest::Path {
         path,
         is_directory,
         line,
      } => CreateAppWindowRequest {
         path: Some(path),
         is_directory: Some(is_directory),
         line,
         ..Default::default()
      },
      CliRequest::Remote {
         connection_id,
         name,
      } => CreateAppWindowRequest {
         remote_connection_id: Some(connection_id),
         remote_connection_name: name,
         ..Default::default()
      },
      CliRequest::Terminal {
         command,
         working_directory,
      } => CreateAppWindowRequest {
         content: Some(
            json!({ "type": "terminal", "command": command, "workingDirectory": working_directory }),
         ),
         working_directory,
         ..Default::default()
      },
      CliRequest::Surface {
         name,
         working_directory,
         resource_id,
      } => {
         let content = match name.as_str() {
            "pr" => {
               json!({ "type": "pullRequest", "prNumber": resource_id, "repoPath": working_directory })
            }
            "issue" => {
               json!({ "type": "githubIssue", "issueNumber": resource_id, "repoPath": working_directory })
            }
            "action" => {
               json!({ "type": "githubAction", "runId": resource_id, "repoPath": working_directory })
            }
            _ => json!({ "type": name }),
         };
         CreateAppWindowRequest {
            content: Some(content),
            working_directory: Some(working_directory),
            ..Default::default()
         }
      }
      _ => CreateAppWindowRequest::default(),
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::commands::development::cli_args::parse_cli_args;
   use std::path::Path;

   #[test]
   fn terminal_cold_start_does_not_need_a_workbench() {
      let requests = parse_cli_args(&["terminal".into()], Path::new("/"));
      assert!(!requests_need_workbench(&requests));
      let request = window_request(requests.into_iter().next().unwrap());
      assert_eq!(request.content.unwrap()["type"], "terminal");
      assert!(request.path.is_none());
   }

   #[test]
   fn reusing_a_terminal_requires_a_workbench() {
      let requests = parse_cli_args(
         &["terminal".into(), "--reuse-window".into()],
         Path::new("/"),
      );
      assert!(requests_need_workbench(&requests));
   }

   #[test]
   fn standalone_surfaces_include_repository_context() {
      let request = window_request(CliRequest::Surface {
         name: "issue".into(),
         working_directory: "/repo".into(),
         resource_id: Some(42),
      });
      assert_eq!(
         request.content.unwrap(),
         json!({ "type": "githubIssue", "repoPath": "/repo", "issueNumber": 42 })
      );
   }
}
