use serde::Serialize;
use std::{
   collections::HashMap,
   path::{Path, PathBuf},
   sync::Mutex,
};
use tauri::State;

#[derive(Default)]
pub struct PendingCliOpenRequests(Mutex<HashMap<String, Vec<CliRequest>>>);

impl PendingCliOpenRequests {
   pub fn push_all(&self, label: &str, requests: Vec<CliRequest>) {
      if requests.is_empty() {
         return;
      }

      let mut pending = self.0.lock().expect("pending CLI requests lock poisoned");
      pending
         .entry(label.to_string())
         .or_default()
         .extend(requests);
   }
}

#[tauri::command]
pub fn take_pending_cli_open_requests(
   window: tauri::WebviewWindow<crate::app_runtime::AthasRuntime>,
   state: State<'_, PendingCliOpenRequests>,
) -> Vec<CliRequest> {
   let mut pending = state.0.lock().expect("pending CLI requests lock poisoned");
   let requests = pending.remove(window.label()).unwrap_or_default();
   if !requests.is_empty() {
      log::info!("Drained {} pending CLI open request(s)", requests.len());
   }
   requests
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenRequest {
   pub path: String,
   pub is_directory: bool,
   pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliRequest {
   NewWindow {
      request: Box<CliRequest>,
   },
   Surface {
      name: String,
      working_directory: String,
      resource_id: Option<u64>,
   },
   Empty,
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

fn quote_command_arg(arg: &str) -> String {
   if !arg.is_empty()
      && arg
         .chars()
         .all(|c| c.is_ascii_alphanumeric() || "_./:=+-".contains(c))
   {
      return arg.to_string();
   }
   if cfg!(windows) {
      format!("\"{}\"", arg.replace('"', "\\\""))
   } else {
      format!("'{}'", arg.replace('\'', "'\\''"))
   }
}

fn is_chromium_runtime_arg(arg: &str) -> bool {
   matches!(
      arg,
      "--disable-features=Vulkan"
         | "--disable-gpu"
         | "--disable-gpu-compositing"
         | "--disable-setuid-sandbox"
         | "--disable-vulkan"
         | "--ozone-platform=x11"
   )
}

fn parse_reused_cli_args(args: &[String], cwd: &Path) -> Vec<CliRequest> {
   let args = args.iter().map(String::as_str).collect::<Vec<_>>();

   if args.is_empty() {
      return Vec::new();
   }

   match args[0] {
      "help" | "-h" | "--help" => Vec::new(),
      "open" => args[1..]
         .iter()
         .map(|arg| parse_open_arg(arg, cwd).map(CliRequest::from))
         .collect::<Option<Vec<_>>>()
         .unwrap_or_default(),
      "web" if args.len() == 2 => args
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
            Some(if args.len() == 2 {
               args[1].to_string()
            } else {
               args[1..]
                  .iter()
                  .map(|arg| quote_command_arg(arg))
                  .collect::<Vec<_>>()
                  .join(" ")
            })
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
         .map(|arg| parse_open_arg(arg, cwd).map(CliRequest::from))
         .collect::<Option<Vec<_>>>()
         .unwrap_or_default(),
   }
}

pub fn parse_cli_args(args: &[String], cwd: &Path) -> Vec<CliRequest> {
   let mut args = args
      .iter()
      .skip_while(|arg| is_chromium_runtime_arg(arg))
      .cloned()
      .collect::<Vec<_>>();
   let mut new_window = None;
   let mut working_directory = cwd.to_path_buf();
   let mut index = 0;
   while index < args.len() {
      match args[index].as_str() {
         "--" => {
            args.remove(index);
            break;
         }
         "--new-window" | "-n" => {
            new_window = Some(true);
            args.remove(index);
         }
         "--reuse-window" | "-r" => {
            new_window = Some(false);
            args.remove(index);
         }
         "--cwd" => {
            if index + 1 >= args.len() {
               return Vec::new();
            }
            working_directory = cwd.join(&args[index + 1]);
            if !working_directory.is_dir() {
               return Vec::new();
            }
            args.drain(index..=index + 1);
         }
         "terminal" | "term" if index == 0 => {
            index += 1;
         }
         value if value.starts_with('-') => return Vec::new(),
         _ if index > 0
            && matches!(args.first().map(String::as_str), Some("terminal" | "term")) =>
         {
            break;
         }
         _ => {
            index += 1;
         }
      }
   }
   let command = args.first().map(String::as_str).unwrap_or("");
   let standalone = matches!(
      command,
      "terminal" | "term" | "settings" | "extensions" | "pr" | "issue" | "action"
   );
   let requests = match command {
      "window" if args.len() == 1 => vec![CliRequest::Empty],
      "" if new_window == Some(true) => vec![CliRequest::Empty],
      "settings" | "extensions" | "pr" | "issue" | "action" => {
         let expected = if matches!(command, "pr" | "issue" | "action") {
            2
         } else {
            1
         };
         if args.len() != expected {
            return Vec::new();
         }
         let resource_id = if matches!(command, "pr" | "issue" | "action") {
            match args
               .get(1)
               .and_then(|id| id.parse::<u64>().ok())
               .filter(|id| *id > 0)
            {
               Some(id) => Some(id),
               None => return Vec::new(),
            }
         } else {
            None
         };
         vec![CliRequest::Surface {
            name: command.to_string(),
            working_directory: working_directory
               .canonicalize()
               .unwrap_or(working_directory)
               .to_string_lossy()
               .into_owned(),
            resource_id,
         }]
      }
      _ => parse_reused_cli_args(&args, &working_directory),
   };
   if new_window.unwrap_or(standalone || command == "window") {
      requests
         .into_iter()
         .map(|request| CliRequest::NewWindow {
            request: Box::new(request),
         })
         .collect()
   } else {
      requests
   }
}

/// Parses a full process argv vector, dropping the executable path before routing user args.
///
/// Used by both cold app startup and the single-instance callback so platform routing keeps the
/// same semantics whether Athas was already running or launched from scratch.
pub fn parse_cli_argv(argv: &[String], cwd: &Path) -> Vec<CliRequest> {
   parse_cli_args(argv.get(1..).unwrap_or_default(), cwd)
}

#[cfg(any(target_os = "macos", test))]
pub fn parse_opened_urls(urls: &[tauri::Url]) -> Vec<CliRequest> {
   urls
      .iter()
      .filter(|url| url.scheme() == "file")
      .filter_map(|url| url.to_file_path().ok())
      .filter_map(|path| {
         parse_open_arg(path.to_string_lossy().as_ref(), Path::new("/")).map(CliRequest::from)
      })
      .collect()
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
   fn parses_macos_opened_file_urls() {
      let manifest_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
      let url = tauri::Url::from_file_path(&manifest_path).expect("manifest path should be a URL");

      assert_eq!(
         parse_opened_urls(&[url]),
         vec![CliRequest::Path {
            path: manifest_path
               .canonicalize()
               .expect("manifest should exist")
               .to_string_lossy()
               .into_owned(),
            is_directory: false,
            line: None,
         }]
      );
   }

   #[test]
   fn ignores_non_file_opened_urls() {
      let url = tauri::Url::parse("athas://open?path=/tmp/file.txt").expect("valid URL");
      assert!(parse_opened_urls(&[url]).is_empty());
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
         "--disable-gpu".to_string(),
         "--disable-gpu-compositing".to_string(),
         "--disable-setuid-sandbox".to_string(),
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
         vec![CliRequest::NewWindow {
            request: Box::new(CliRequest::Terminal {
               command: Some("npm test".to_string()),
               working_directory: Some(cwd.canonicalize().unwrap().to_string_lossy().into_owned()),
            })
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

   #[test]
   fn parse_cli_argv_drops_executable_for_cold_start() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec![
         "/Applications/Athas.app/Contents/MacOS/athas".to_string(),
         ".".to_string(),
      ];
      let requests = parse_cli_argv(&args, &cwd);

      assert_eq!(requests.len(), 1);
      assert!(matches!(requests[0], CliRequest::Path { .. }));
   }

   #[test]
   fn parse_cli_argv_drops_executable_for_single_instance_forwarding() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec![
         "C:\\Program Files\\Athas\\athas.exe".to_string(),
         "terminal".to_string(),
         "bun test".to_string(),
      ];

      assert_eq!(
         parse_cli_argv(&args, &cwd),
         vec![CliRequest::NewWindow {
            request: Box::new(CliRequest::Terminal {
               command: Some("bun test".to_string()),
               working_directory: Some(cwd.canonicalize().unwrap().to_string_lossy().into_owned()),
            })
         }]
      );
   }
   #[cfg(unix)]
   #[test]
   fn terminal_options_preserve_command_arguments() {
      let args = [
         "terminal",
         "--cwd",
         ".",
         "--",
         "printf",
         "%s",
         "two words",
         "$(echo unsafe)",
         "--new-window",
         "--disable-gpu",
      ];
      let requests = parse_cli_args(&args.map(String::from), Path::new("/"));
      let CliRequest::NewWindow { request } = &requests[0] else {
         panic!("expected new window")
      };
      let CliRequest::Terminal {
         command,
         working_directory,
      } = request.as_ref()
      else {
         panic!("expected terminal")
      };
      assert_eq!(
         command.as_deref(),
         Some("printf '%s' 'two words' '$(echo unsafe)' --new-window --disable-gpu")
      );
      assert_eq!(working_directory.as_deref(), Some("/"));
   }

   #[test]
   fn cwd_after_resource_id_and_short_window_flags() {
      let cwd = std::env::current_dir().unwrap();
      let requests = parse_cli_args(&["issue", "42", "--cwd", "."].map(String::from), &cwd);
      let CliRequest::NewWindow { request } = &requests[0] else {
         panic!("expected new window")
      };
      assert!(matches!(
         request.as_ref(),
         CliRequest::Surface {
            resource_id: Some(42),
            ..
         }
      ));
      assert!(matches!(
         parse_cli_args(&["open", "-n", "."].map(String::from), &cwd)[0],
         CliRequest::NewWindow { .. }
      ));
      assert!(matches!(
         parse_cli_args(&["terminal", "-r"].map(String::from), &cwd)[0],
         CliRequest::Terminal { .. }
      ));
      assert!(matches!(
         parse_cli_args(&["-n"].map(String::from), &cwd)[0],
         CliRequest::NewWindow { .. }
      ));
   }

   #[test]
   fn rejects_invalid_options_and_missing_targets() {
      let cwd = std::env::current_dir().unwrap();
      for args in [
         vec!["terminal", "--cwd"],
         vec!["terminal", "--cwd", "/athas-nonexistent-dir-123"],
         vec!["--unknown"],
         vec!["issue", "0"],
         vec!["pr"],
         vec!["settings", "extra"],
         vec!["open", ".", "/athas-nonexistent-dir-123"],
      ] {
         assert!(
            parse_cli_args(
               &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(),
               &cwd
            )
            .is_empty(),
            "{args:?}"
         );
      }
   }

   #[test]
   fn pending_requests_belong_to_the_target_window() {
      let state = PendingCliOpenRequests::default();
      state.push_all("main-1", vec![CliRequest::Empty]);
      state.push_all(
         "main-2",
         vec![CliRequest::Web {
            url: "https://athas.dev".into(),
         }],
      );
      let mut pending = state.0.lock().unwrap();
      assert_eq!(pending.remove("main-1").unwrap(), vec![CliRequest::Empty]);
      assert_eq!(pending["main-2"].len(), 1);
   }
}
