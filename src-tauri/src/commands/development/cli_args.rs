use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct OpenRequest {
   pub path: String,
   pub is_directory: bool,
   pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliRequest {
   Path {
      path: String,
      is_directory: bool,
      line: Option<u32>,
   },
   Web {
      url: String,
   },
   Terminal {
      command: Option<String>,
      working_directory: Option<String>,
   },
   Remote {
      connection_id: String,
      name: Option<String>,
   },
}

impl From<OpenRequest> for CliRequest {
   fn from(request: OpenRequest) -> Self {
      Self::Path {
         path: request.path,
         is_directory: request.is_directory,
         line: request.line,
      }
   }
}

/// Splits a path argument into the file path and optional line number.
/// Handles `file:line` syntax while respecting Windows drive letters (e.g. `C:\foo`).
pub fn split_path_and_line(arg: &str) -> (&str, Option<u32>) {
   // Find the last colon
   if let Some(pos) = arg.rfind(':') {
      let after = &arg[pos + 1..];
      // Only treat as line number if everything after the last colon is digits
      if !after.is_empty()
         && after.chars().all(|c| c.is_ascii_digit())
         && let Ok(line) = after.parse::<u32>()
         && line > 0
      {
         return (&arg[..pos], Some(line));
      }
   }
   (arg, None)
}

/// Parses a CLI argument into an `OpenRequest`, resolving relative paths against `cwd`.
pub fn parse_open_arg(arg: &str, cwd: &Path) -> Option<OpenRequest> {
   let (file_part, line) = split_path_and_line(arg);

   let path = if Path::new(file_part).is_absolute() {
      PathBuf::from(file_part)
   } else {
      cwd.join(file_part)
   };

   // Canonicalize to resolve `.`, `..`, symlinks
   let canonical = path.canonicalize().ok()?;
   let is_directory = canonical.is_dir();

   Some(OpenRequest {
      path: canonical.to_string_lossy().into_owned(),
      is_directory,
      line: if is_directory { None } else { line },
   })
}

fn is_chromium_runtime_arg(arg: &str) -> bool {
   arg == "--disable-vulkan" || arg == "--ozone-platform=x11" || arg == "--disable-features=Vulkan"
}

pub fn parse_cli_args(args: &[String], cwd: &Path) -> Vec<CliRequest> {
   let args = args
      .iter()
      .map(String::as_str)
      .filter(|arg| !is_chromium_runtime_arg(arg))
      .collect::<Vec<_>>();

   if args.is_empty() {
      return Vec::new();
   }

   match args[0] {
      "help" | "-h" | "--help" => Vec::new(),
      "open" => args[1..]
         .iter()
         .filter(|arg| !arg.starts_with('-'))
         .filter_map(|arg| parse_open_arg(arg, cwd).map(CliRequest::from))
         .collect(),
      "web" => args
         .get(1)
         .map(|url| {
            vec![CliRequest::Web {
               url: (*url).to_string(),
            }]
         })
         .unwrap_or_default(),
      "terminal" | "term" => {
         let working_directory = cwd
            .canonicalize()
            .unwrap_or_else(|_| cwd.to_path_buf())
            .to_string_lossy()
            .into_owned();
         let command = if args.len() > 1 {
            Some(args[1..].join(" "))
         } else {
            None
         };
         vec![CliRequest::Terminal {
            command,
            working_directory: Some(working_directory),
         }]
      }
      "remote" => args
         .get(1)
         .map(|connection_id| CliRequest::Remote {
            connection_id: (*connection_id).to_string(),
            name: if args.len() > 2 {
               Some(args[2..].join(" "))
            } else {
               None
            },
         })
         .into_iter()
         .collect(),
      _ => args
         .iter()
         .filter(|arg| !arg.starts_with('-'))
         .filter_map(|arg| parse_open_arg(arg, cwd).map(CliRequest::from))
         .collect(),
   }
}

#[cfg(test)]
mod tests {
   fn to_deep_link_url(req: &OpenRequest) -> String {
      let encoded_path = url_encode_path(&req.path);
      let mut url = format!("athas://open?path={}", encoded_path);
      if let Some(line) = req.line {
         url.push_str(&format!("&line={}", line));
      }
      if req.is_directory {
         url.push_str("&type=directory");
      }
      url
   }

   fn url_encode_path(path: &str) -> String {
      let mut encoded = String::with_capacity(path.len() * 2);
      for byte in path.bytes() {
         match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' | b'\\' => {
               encoded.push(byte as char);
            }
            _ => {
               encoded.push_str(&format!("%{:02X}", byte));
            }
         }
      }
      encoded
   }
   use super::*;

   #[test]
   fn split_simple_file() {
      let (path, line) = split_path_and_line("foo.txt");
      assert_eq!(path, "foo.txt");
      assert_eq!(line, None);
   }

   #[test]
   fn split_file_with_line() {
      let (path, line) = split_path_and_line("foo.txt:42");
      assert_eq!(path, "foo.txt");
      assert_eq!(line, Some(42));
   }

   #[test]
   fn split_file_with_zero_line() {
      let (path, line) = split_path_and_line("foo.txt:0");
      assert_eq!(path, "foo.txt:0");
      assert_eq!(line, None);
   }

   #[test]
   fn split_no_line_trailing_colon() {
      let (path, line) = split_path_and_line("foo.txt:");
      assert_eq!(path, "foo.txt:");
      assert_eq!(line, None);
   }

   #[test]
   fn split_windows_drive_no_line() {
      let (path, line) = split_path_and_line("C:\\Users\\foo\\bar.txt");
      assert_eq!(path, "C:\\Users\\foo\\bar.txt");
      assert_eq!(line, None);
   }

   #[test]
   fn split_windows_drive_with_line() {
      let (path, line) = split_path_and_line("C:\\Users\\foo\\bar.txt:10");
      assert_eq!(path, "C:\\Users\\foo\\bar.txt");
      assert_eq!(line, Some(10));
   }

   #[test]
   fn to_deep_link_url_file_with_line() {
      let req = OpenRequest {
         path: "/Users/test/foo.txt".to_string(),
         is_directory: false,
         line: Some(42),
      };
      let url = to_deep_link_url(&req);
      assert_eq!(url, "athas://open?path=/Users/test/foo.txt&line=42");
   }

   #[test]
   fn to_deep_link_url_directory() {
      let req = OpenRequest {
         path: "/Users/test/project".to_string(),
         is_directory: true,
         line: None,
      };
      let url = to_deep_link_url(&req);
      assert_eq!(url, "athas://open?path=/Users/test/project&type=directory");
   }

   #[test]
   fn to_deep_link_url_path_with_spaces() {
      let req = OpenRequest {
         path: "/Users/test/my project/file.txt".to_string(),
         is_directory: false,
         line: None,
      };
      let url = to_deep_link_url(&req);
      assert_eq!(url, "athas://open?path=/Users/test/my%20project/file.txt");
   }

   #[test]
   fn parse_open_arg_dot_resolves_to_cwd() {
      let cwd = std::env::current_dir().unwrap();
      let req = parse_open_arg(".", &cwd).unwrap();
      assert_eq!(req.path, cwd.canonicalize().unwrap().to_string_lossy());
      assert!(req.is_directory);
      assert_eq!(req.line, None);
   }

   #[test]
   fn parse_open_arg_nonexistent_returns_none() {
      let cwd = std::env::current_dir().unwrap();
      let req = parse_open_arg("this_file_does_not_exist_xyz_123.txt", &cwd);
      assert!(req.is_none());
   }

   #[test]
   fn parse_cli_args_web_command() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec!["web".to_string(), "https://athas.dev".to_string()];
      assert_eq!(
         parse_cli_args(&args, &cwd),
         vec![CliRequest::Web {
            url: "https://athas.dev".to_string()
         }]
      );
   }

   #[test]
   fn parse_cli_args_ignores_linux_chromium_runtime_flags() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec![
         "--ozone-platform=x11".to_string(),
         "--disable-vulkan".to_string(),
         "--disable-features=Vulkan".to_string(),
         "web".to_string(),
         "https://athas.dev".to_string(),
      ];

      assert_eq!(
         parse_cli_args(&args, &cwd),
         vec![CliRequest::Web {
            url: "https://athas.dev".to_string()
         }]
      );
   }

   #[test]
   fn parse_cli_args_terminal_command() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec![
         "terminal".to_string(),
         "npm".to_string(),
         "test".to_string(),
      ];

      assert_eq!(
         parse_cli_args(&args, &cwd),
         vec![CliRequest::Terminal {
            command: Some("npm test".to_string()),
            working_directory: Some(cwd.canonicalize().unwrap().to_string_lossy().into_owned()),
         }]
      );
   }

   #[test]
   fn parse_cli_args_remote_command() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec![
         "remote".to_string(),
         "conn-1".to_string(),
         "My".to_string(),
         "Server".to_string(),
      ];

      assert_eq!(
         parse_cli_args(&args, &cwd),
         vec![CliRequest::Remote {
            connection_id: "conn-1".to_string(),
            name: Some("My Server".to_string()),
         }]
      );
   }

   #[test]
   fn parse_cli_args_open_subcommand() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec!["open".to_string(), ".".to_string()];
      let requests = parse_cli_args(&args, &cwd);

      assert_eq!(requests.len(), 1);
      assert_eq!(
         requests[0],
         CliRequest::Path {
            path: cwd.canonicalize().unwrap().to_string_lossy().into_owned(),
            is_directory: true,
            line: None,
         }
      );
   }
}
