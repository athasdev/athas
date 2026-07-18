use serde::{Deserialize, Serialize};
use std::{
   io::Write,
   path::PathBuf,
   process::{Command, Stdio},
};

const WSL_EXE: &str = "wsl.exe";
const WSL_URI_PREFIX: &str = "wsl://";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WslDistribution {
   pub name: String,
   pub state: Option<String>,
   pub version: Option<u8>,
   pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WslPath {
   pub distro: String,
   pub linux_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WslFileEntry {
   pub name: String,
   pub path: String,
   pub is_dir: bool,
   pub size: u64,
   pub is_symlink: bool,
   pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WslSymlinkInfo {
   pub is_symlink: bool,
   pub target: Option<String>,
   pub is_dir: bool,
}

#[derive(Debug)]
struct CommandOutput {
   status_success: bool,
   stdout: Vec<u8>,
   stderr: Vec<u8>,
}

pub fn is_wsl_path(path: &str) -> bool {
   path.starts_with(WSL_URI_PREFIX)
}

pub fn parse_wsl_uri(path: &str) -> Result<WslPath, String> {
   let rest = path
      .strip_prefix(WSL_URI_PREFIX)
      .ok_or_else(|| format!("Not a WSL path: {path}"))?;
   let (distro, linux_path) = rest.split_once('/').unwrap_or((rest, ""));
   let distro = distro.trim();

   if distro.is_empty() {
      return Err("WSL path is missing a distribution name".to_string());
   }

   Ok(WslPath {
      distro: distro.to_string(),
      linux_path: normalize_linux_path(linux_path),
   })
}

pub fn build_wsl_uri(distro: &str, linux_path: &str) -> String {
   format!(
      "{WSL_URI_PREFIX}{}{}",
      distro.trim(),
      normalize_linux_path(linux_path)
   )
}

pub fn normalize_linux_path(path: &str) -> String {
   let trimmed = path.trim();
   if trimmed.is_empty() || trimmed == "~" {
      return "/".to_string();
   }

   let mut normalized = trimmed.replace('\\', "/");
   if !normalized.starts_with('/') {
      normalized = format!("/{normalized}");
   }

   while normalized.contains("//") {
      normalized = normalized.replace("//", "/");
   }

   let mut parts = Vec::new();
   for part in normalized.split('/') {
      if part.is_empty() || part == "." {
         continue;
      }
      if part == ".." {
         parts.pop();
         continue;
      }
      parts.push(part);
   }

   if parts.is_empty() {
      "/".to_string()
   } else {
      format!("/{}", parts.join("/"))
   }
}

pub fn join_linux_path(parent: &str, child: &str) -> String {
   let parent = normalize_linux_path(parent);
   let child = child.trim_matches('/');
   if child.is_empty() {
      return parent;
   }
   if parent == "/" {
      format!("/{child}")
   } else {
      format!("{parent}/{child}")
   }
}

pub fn wsl_shell_id(distro: &str) -> String {
   format!("wsl:{distro}")
}

pub fn parse_wsl_shell_id(shell_id: &str) -> Option<&str> {
   shell_id
      .strip_prefix("wsl:")
      .filter(|distro| !distro.is_empty())
}

pub fn windows_path_to_wsl_path(path: &str) -> Option<String> {
   let normalized = path.replace('\\', "/");

   if let Some((drive, rest)) = normalized.split_once(':')
      && drive.len() == 1
      && drive.chars().all(|c| c.is_ascii_alphabetic())
   {
      let drive = drive.to_ascii_lowercase();
      let rest = rest.trim_start_matches('/');
      return Some(if rest.is_empty() {
         format!("/mnt/{drive}")
      } else {
         format!("/mnt/{drive}/{rest}")
      });
   }

   for prefix in ["//wsl.localhost/", "//wsl$/"] {
      if let Some(rest) = normalized.strip_prefix(prefix) {
         let (_, linux_path) = rest.split_once('/')?;
         return Some(normalize_linux_path(linux_path));
      }
   }

   None
}

pub fn wsl_uri_to_windows_unc(path: &str) -> Result<String, String> {
   let parsed = parse_wsl_uri(path)?;
   Ok(wsl_path_to_windows_unc(
      &parsed.distro,
      &parsed.linux_path,
      WslUncFlavor::Localhost,
   ))
}

pub fn windows_unc_to_wsl_uri(path: &str) -> Option<String> {
   let normalized = path.replace('\\', "/");

   for prefix in ["//wsl.localhost/", "//wsl$/"] {
      if let Some(rest) = normalized.strip_prefix(prefix) {
         let (distro, linux_path) = rest.split_once('/').unwrap_or((rest, ""));
         if distro.is_empty() {
            return None;
         }
         return Some(build_wsl_uri(distro, linux_path));
      }
   }

   None
}

#[derive(Debug, Clone, Copy)]
pub enum WslUncFlavor {
   Localhost,
   Legacy,
}

pub fn wsl_path_to_windows_unc(distro: &str, linux_path: &str, flavor: WslUncFlavor) -> String {
   let server = match flavor {
      WslUncFlavor::Localhost => r"\\wsl.localhost",
      WslUncFlavor::Legacy => r"\\wsl$",
   };
   let mut path = format!(r"{server}\{}", distro.trim());

   for segment in normalize_linux_path(linux_path)
      .trim_start_matches('/')
      .split('/')
      .filter(|segment| !segment.is_empty())
   {
      path.push('\\');
      path.push_str(segment);
   }

   path
}

pub fn list_distributions() -> Result<Vec<WslDistribution>, String> {
   if !cfg!(target_os = "windows") {
      return Ok(Vec::new());
   }

   let output = run_host_wsl(&["--list", "--verbose"])?;
   if !output.status_success {
      return Err(format_wsl_error(
         "Failed to list WSL distributions",
         &output,
      ));
   }

   Ok(parse_verbose_distribution_list(&decode_wsl_output(
      &output.stdout,
   )))
}

pub fn read_directory(distro: &str, linux_path: &str) -> Result<Vec<WslFileEntry>, String> {
   let path = normalize_linux_path(linux_path);
   let output = run_wsl(
      distro,
      &[
         "--exec",
         "sh",
         "-lc",
         r#"if [ ! -d "$1" ]; then
  printf 'Not a directory: %s\n' "$1" >&2
  exit 1
fi
if [ ! -r "$1" ] || [ ! -x "$1" ]; then
  printf 'Directory is not readable: %s\n' "$1" >&2
  exit 1
fi
for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do
  [ -e "$p" ] || [ -L "$p" ] || continue
  name=${p##*/}
  type=f
  [ -d "$p" ] && type=d
  [ -L "$p" ] && type=l
  size=$(wc -c < "$p" 2>/dev/null || printf 0)
  target=
  [ -L "$p" ] && target=$(readlink "$p" 2>/dev/null || true)
  printf '%s\0%s\0%s\0%s\0%s\0' "$name" "$p" "$type" "$size" "$target"
done"#,
         "athas-list-dir",
         &path,
      ],
      None,
   )?;

   if !output.status_success {
      return Err(format_wsl_error("Failed to read WSL directory", &output));
   }

   parse_directory_entries(distro, &output.stdout)
}

pub fn read_file(distro: &str, linux_path: &str) -> Result<String, String> {
   let bytes = read_file_bytes(distro, linux_path)?;
   String::from_utf8(bytes).map_err(|e| format!("WSL file is not valid UTF-8: {e}"))
}

pub fn read_file_bytes(distro: &str, linux_path: &str) -> Result<Vec<u8>, String> {
   let path = normalize_linux_path(linux_path);
   let output = run_wsl(distro, &["--exec", "cat", &path], None)?;
   if output.status_success {
      Ok(output.stdout)
   } else {
      Err(format_wsl_error("Failed to read WSL file", &output))
   }
}

pub fn write_file(distro: &str, linux_path: &str, content: &[u8]) -> Result<(), String> {
   let path = normalize_linux_path(linux_path);
   let output = run_wsl(
      distro,
      &[
         "--exec",
         "sh",
         "-lc",
         r#"mkdir -p "$(dirname "$1")" && cat > "$1""#,
         "athas-write-file",
         &path,
      ],
      Some(content),
   )?;

   if output.status_success {
      Ok(())
   } else {
      Err(format_wsl_error("Failed to write WSL file", &output))
   }
}

pub fn create_file(distro: &str, linux_path: &str) -> Result<(), String> {
   let path = normalize_linux_path(linux_path);
   let output = run_wsl(
      distro,
      &[
         "--exec",
         "sh",
         "-lc",
         r#"mkdir -p "$(dirname "$1")" && : > "$1""#,
         "athas-create-file",
         &path,
      ],
      None,
   )?;

   if output.status_success {
      Ok(())
   } else {
      Err(format_wsl_error("Failed to create WSL file", &output))
   }
}

pub fn create_directory(distro: &str, linux_path: &str) -> Result<(), String> {
   let path = normalize_linux_path(linux_path);
   let output = run_wsl(distro, &["--exec", "mkdir", "-p", &path], None)?;
   if output.status_success {
      Ok(())
   } else {
      Err(format_wsl_error("Failed to create WSL directory", &output))
   }
}

pub fn delete_path(distro: &str, linux_path: &str, is_directory: bool) -> Result<(), String> {
   let path = normalize_linux_path(linux_path);
   let mut args = vec!["--exec", "rm"];
   if is_directory {
      args.push("-rf");
   } else {
      args.push("-f");
   }
   args.push(&path);

   let output = run_wsl(distro, &args, None)?;
   if output.status_success {
      Ok(())
   } else {
      Err(format_wsl_error("Failed to delete WSL path", &output))
   }
}

pub fn rename_path(distro: &str, source_path: &str, target_path: &str) -> Result<(), String> {
   let source = normalize_linux_path(source_path);
   let target = normalize_linux_path(target_path);
   let output = run_wsl(
      distro,
      &[
         "--exec",
         "sh",
         "-lc",
         r#"mkdir -p "$(dirname "$2")" && mv -- "$1" "$2""#,
         "athas-rename-path",
         &source,
         &target,
      ],
      None,
   )?;

   if output.status_success {
      Ok(())
   } else {
      Err(format_wsl_error("Failed to rename WSL path", &output))
   }
}

pub fn copy_path(
   distro: &str,
   source_path: &str,
   target_path: &str,
   _is_directory: bool,
) -> Result<(), String> {
   let source = normalize_linux_path(source_path);
   let target = normalize_linux_path(target_path);
   let output = run_wsl(
      distro,
      &[
         "--exec",
         "sh",
         "-lc",
         r#"mkdir -p "$(dirname "$2")" && cp -a -- "$1" "$2""#,
         "athas-copy-path",
         &source,
         &target,
      ],
      None,
   )?;

   if output.status_success {
      Ok(())
   } else {
      Err(format_wsl_error("Failed to copy WSL path", &output))
   }
}

pub fn symlink_info(distro: &str, linux_path: &str) -> Result<WslSymlinkInfo, String> {
   let path = normalize_linux_path(linux_path);
   let output = run_wsl(
      distro,
      &[
         "--exec",
         "sh",
         "-lc",
         r#"is_symlink=false
target=
is_dir=false
[ -L "$1" ] && is_symlink=true && target=$(readlink "$1" 2>/dev/null || true)
[ -d "$1" ] && is_dir=true
printf '%s\0%s\0%s\0' "$is_symlink" "$target" "$is_dir""#,
         "athas-symlink-info",
         &path,
      ],
      None,
   )?;

   if !output.status_success {
      return Err(format_wsl_error("Failed to inspect WSL symlink", &output));
   }

   let mut fields = output.stdout.split(|byte| *byte == 0);
   let is_symlink = fields.next() == Some(b"true".as_slice());
   let target = fields
      .next()
      .and_then(|value| String::from_utf8(value.to_vec()).ok())
      .filter(|value| !value.is_empty());
   let is_dir = fields.next() == Some(b"true".as_slice());

   Ok(WslSymlinkInfo {
      is_symlink,
      target,
      is_dir,
   })
}

pub fn home_dir(distro: &str) -> Result<String, String> {
   let output = run_wsl(
      distro,
      &["--exec", "sh", "-lc", r#"printf '%s' "$HOME""#],
      None,
   )?;
   if !output.status_success {
      return Err(format_wsl_error(
         "Failed to resolve WSL home directory",
         &output,
      ));
   }

   let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
   Ok(if home.is_empty() {
      "/".to_string()
   } else {
      home
   })
}

pub fn resolve_windows_path(path: &str) -> Result<String, String> {
   if !is_wsl_path(path) {
      return Ok(path.to_string());
   }
   wsl_uri_to_windows_unc(path)
}

fn run_host_wsl(args: &[&str]) -> Result<CommandOutput, String> {
   let output = Command::new(WSL_EXE)
      .args(args)
      .output()
      .map_err(|e| format!("Failed to run {WSL_EXE}: {e}"))?;

   Ok(CommandOutput {
      status_success: output.status.success(),
      stdout: output.stdout,
      stderr: output.stderr,
   })
}

fn run_wsl(distro: &str, args: &[&str], stdin: Option<&[u8]>) -> Result<CommandOutput, String> {
   if !cfg!(target_os = "windows") {
      return Err("WSL is only available on Windows.".to_string());
   }

   let mut command = Command::new(WSL_EXE);
   command
      .args(["--distribution", distro])
      .args(args)
      .stdin(if stdin.is_some() {
         Stdio::piped()
      } else {
         Stdio::null()
      })
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

   let mut child = command
      .spawn()
      .map_err(|e| format!("Failed to run {WSL_EXE}: {e}"))?;

   if let Some(input) = stdin
      && let Some(mut child_stdin) = child.stdin.take()
   {
      child_stdin
         .write_all(input)
         .map_err(|e| format!("Failed to write to WSL command stdin: {e}"))?;
   }

   let output = child
      .wait_with_output()
      .map_err(|e| format!("Failed to wait for WSL command: {e}"))?;

   Ok(CommandOutput {
      status_success: output.status.success(),
      stdout: output.stdout,
      stderr: output.stderr,
   })
}

fn parse_verbose_distribution_list(output: &str) -> Vec<WslDistribution> {
   output
      .lines()
      .filter_map(|line| {
         let trimmed = line.trim_matches(char::from(0)).trim();
         if trimmed.is_empty() || trimmed.to_ascii_lowercase().starts_with("name") {
            return None;
         }

         let (is_default, rest) = trimmed
            .strip_prefix('*')
            .map(|value| (true, value.trim()))
            .unwrap_or((false, trimmed));
         let parts = rest.split_whitespace().collect::<Vec<_>>();
         if parts.is_empty() {
            return None;
         }

         let version = parts.last().and_then(|value| value.parse::<u8>().ok());
         let state = if parts.len() >= 2 {
            parts.get(parts.len() - 2).map(|value| (*value).to_string())
         } else {
            None
         };
         let name_end = if version.is_some() && state.is_some() {
            parts.len().saturating_sub(2)
         } else {
            parts.len()
         };
         let name = parts[..name_end].join(" ");

         if name.is_empty() {
            None
         } else {
            Some(WslDistribution {
               name,
               state,
               version,
               is_default,
            })
         }
      })
      .collect()
}

fn parse_directory_entries(distro: &str, bytes: &[u8]) -> Result<Vec<WslFileEntry>, String> {
   let fields = bytes
      .split(|byte| *byte == 0)
      .filter(|field| !field.is_empty())
      .collect::<Vec<_>>();
   let mut entries = Vec::new();

   for chunk in fields.chunks(5) {
      if chunk.len() < 5 {
         continue;
      }

      let name = String::from_utf8(chunk[0].to_vec())
         .map_err(|e| format!("Invalid UTF-8 in WSL file name: {e}"))?;
      let linux_path = String::from_utf8(chunk[1].to_vec())
         .map_err(|e| format!("Invalid UTF-8 in WSL path: {e}"))?;
      let entry_type = String::from_utf8_lossy(chunk[2]);
      let size = String::from_utf8_lossy(chunk[3])
         .trim()
         .parse()
         .unwrap_or(0);
      let target = String::from_utf8(chunk[4].to_vec())
         .ok()
         .filter(|value| !value.is_empty());
      let is_symlink = entry_type == "l";

      entries.push(WslFileEntry {
         name,
         path: build_wsl_uri(distro, &linux_path),
         is_dir: entry_type == "d",
         size,
         is_symlink,
         target,
      });
   }

   entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
   });

   Ok(entries)
}

fn decode_wsl_output(bytes: &[u8]) -> String {
   if bytes.len() >= 2 && bytes.len() % 2 == 0 {
      let odd_zero_count = bytes
         .chunks_exact(2)
         .filter(|pair| pair.get(1) == Some(&0))
         .count();

      if odd_zero_count > bytes.len() / 4 {
         let utf16 = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
         return String::from_utf16_lossy(&utf16);
      }
   }

   String::from_utf8_lossy(bytes).replace('\0', "")
}

fn format_wsl_error(context: &str, output: &CommandOutput) -> String {
   let stderr = decode_wsl_output(&output.stderr);
   let stdout = decode_wsl_output(&output.stdout);
   let detail = if !stderr.trim().is_empty() {
      stderr.trim()
   } else {
      stdout.trim()
   };

   if detail.is_empty() {
      context.to_string()
   } else {
      format!("{context}: {detail}")
   }
}

pub fn path_buf_for_display(path: &str) -> PathBuf {
   PathBuf::from(path)
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn parses_wsl_uri_root_and_nested_paths() {
      assert_eq!(
         parse_wsl_uri("wsl://Ubuntu/home/me/project").unwrap(),
         WslPath {
            distro: "Ubuntu".to_string(),
            linux_path: "/home/me/project".to_string(),
         }
      );
      assert_eq!(parse_wsl_uri("wsl://Ubuntu").unwrap().linux_path, "/");
   }

   #[test]
   fn builds_wsl_uri_with_normalized_linux_path() {
      assert_eq!(
         build_wsl_uri("Ubuntu", "home/me/project/"),
         "wsl://Ubuntu/home/me/project"
      );
      assert_eq!(
         build_wsl_uri("Ubuntu", "/home/me/../project/./src"),
         "wsl://Ubuntu/home/project/src"
      );
   }

   #[test]
   fn parses_verbose_distribution_rows() {
      let output = "  NAME            STATE           VERSION\n* Ubuntu          Running         \
                    2\n  Debian          Stopped         1\n";

      assert_eq!(
         parse_verbose_distribution_list(output),
         vec![
            WslDistribution {
               name: "Ubuntu".to_string(),
               state: Some("Running".to_string()),
               version: Some(2),
               is_default: true,
            },
            WslDistribution {
               name: "Debian".to_string(),
               state: Some("Stopped".to_string()),
               version: Some(1),
               is_default: false,
            },
         ]
      );
   }

   #[test]
   fn converts_windows_drive_paths_to_wsl_mounts() {
      assert_eq!(
         windows_path_to_wsl_path(r"C:\Users\me\repo").as_deref(),
         Some("/mnt/c/Users/me/repo")
      );
   }

   #[test]
   fn converts_wsl_uri_to_unc_path() {
      assert_eq!(
         wsl_uri_to_windows_unc("wsl://Ubuntu/home/me/repo").unwrap(),
         r"\\wsl.localhost\Ubuntu\home\me\repo"
      );
   }

   #[test]
   fn converts_unc_path_to_wsl_uri() {
      assert_eq!(
         windows_unc_to_wsl_uri(r"\\wsl.localhost\Ubuntu\home\me\repo").as_deref(),
         Some("wsl://Ubuntu/home/me/repo")
      );
   }
}
