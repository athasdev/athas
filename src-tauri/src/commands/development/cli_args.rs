use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct OpenRequest {
   pub path: String,
   pub is_directory: bool,
   pub line: Option<u32>,
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

pub fn collect_open_requests(args: &[String], cwd: &Path) -> Vec<OpenRequest> {
   args
      .iter()
      .filter(|arg| !arg.starts_with('-'))
      .filter_map(|arg| parse_open_arg(arg, cwd))
      .collect()
}

#[tauri::command]
pub fn get_startup_open_requests() -> Vec<OpenRequest> {
   let cwd = std::env::current_dir().unwrap_or_default();
   let args: Vec<String> = std::env::args().skip(1).collect();
   collect_open_requests(&args, &cwd)
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
   fn collect_open_requests_filters_flags_and_keeps_valid_paths() {
      let cwd = std::env::current_dir().unwrap();
      let args = vec![
         "--verbose".to_string(),
         ".".to_string(),
         "this_file_does_not_exist_xyz_123.txt".to_string(),
      ];

      let requests = collect_open_requests(&args, &cwd);

      assert_eq!(requests.len(), 1);
      assert_eq!(
         requests[0].path,
         cwd.canonicalize().unwrap().to_string_lossy()
      );
      assert!(requests[0].is_directory);
      assert_eq!(requests[0].line, None);
   }
}
