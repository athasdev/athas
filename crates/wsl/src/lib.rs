use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   ffi::OsStr,
   io::Write,
   path::PathBuf,
   process::{Command, Stdio},
   sync::{Mutex, OnceLock},
   time::{Duration, Instant},
};

const WSL_EXE: &str = "wsl.exe";
const WSL_URI_PREFIX: &str = "wsl://";
const WSL_LOCALHOST_SERVER: &str = "wsl.localhost";
const WSL_LEGACY_SERVER: &str = "wsl$";
const WSLENV: &str = "WSLENV";
const GIT_PROBE_RETRY_INTERVAL: Duration = Duration::from_secs(60);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

   parse_windows_unc_path(path).map(|(parsed, _)| parsed.linux_path)
}

pub fn wsl_uri_to_windows_unc(path: &str) -> Result<String, String> {
   let parsed = parse_wsl_uri(path)?;
   let flavor = resolve_unc_flavor(&parsed.distro);
   Ok(wsl_path_to_windows_unc(
      &parsed.distro,
      &parsed.linux_path,
      flavor,
   ))
}

pub fn windows_unc_to_wsl_uri(path: &str) -> Option<String> {
   parse_windows_unc_path(path).map(|(parsed, _)| build_wsl_uri(&parsed.distro, &parsed.linux_path))
}

/// Parses a Windows share path that points into a WSL distribution, such as
/// `\\wsl$\Ubuntu\home\me` or `\\wsl.localhost\Ubuntu\home\me`, in either
/// separator style and including the `\\?\UNC\` form produced by path
/// canonicalization.
pub fn parse_windows_unc_path(path: &str) -> Option<(WslPath, WslUncFlavor)> {
   let normalized = path.trim().replace('\\', "/");
   let rest = normalized
      .strip_prefix("//?/UNC/")
      .or_else(|| normalized.strip_prefix("//"))?;
   let (server, rest) = rest.split_once('/').unwrap_or((rest, ""));
   let flavor = if server.eq_ignore_ascii_case(WSL_LOCALHOST_SERVER) {
      WslUncFlavor::Localhost
   } else if server.eq_ignore_ascii_case(WSL_LEGACY_SERVER) {
      WslUncFlavor::Legacy
   } else {
      return None;
   };
   let (distro, linux_path) = rest.split_once('/').unwrap_or((rest, ""));
   let distro = distro.trim();
   if distro.is_empty() {
      return None;
   }

   Some((
      WslPath {
         distro: distro.to_string(),
         linux_path: normalize_linux_path(linux_path),
      },
      flavor,
   ))
}

/// Recognizes both spellings of a WSL location: the `wsl://` scheme used by
/// the app and the Windows share paths returned by native dialogs.
pub fn parse_wsl_location(path: &str) -> Option<WslPath> {
   if is_wsl_path(path) {
      parse_wsl_uri(path).ok()
   } else {
      parse_windows_unc_path(path).map(|(parsed, _)| parsed)
   }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WslUncFlavor {
   Localhost,
   Legacy,
}

fn unc_flavor_cache() -> &'static Mutex<HashMap<String, WslUncFlavor>> {
   static CACHE: OnceLock<Mutex<HashMap<String, WslUncFlavor>>> = OnceLock::new();
   CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Picks the share name that reaches a distribution on this machine.
/// `\\wsl.localhost` only exists on newer WSL releases, so older Windows 10
/// installs still need `\\wsl$`. The first successful probe is cached.
pub fn resolve_unc_flavor(distro: &str) -> WslUncFlavor {
   if !cfg!(target_os = "windows") {
      return WslUncFlavor::Localhost;
   }

   let key = distro.trim().to_ascii_lowercase();
   if let Some(flavor) = unc_flavor_cache()
      .lock()
      .ok()
      .and_then(|cache| cache.get(&key).copied())
   {
      return flavor;
   }

   for flavor in [WslUncFlavor::Localhost, WslUncFlavor::Legacy] {
      let root = wsl_path_to_windows_unc(distro, "/", flavor);
      if std::fs::metadata(&root)
         .map(|metadata| metadata.is_dir())
         .unwrap_or(false)
      {
         if let Ok(mut cache) = unc_flavor_cache().lock() {
            cache.insert(key, flavor);
         }
         return flavor;
      }
   }

   WslUncFlavor::Localhost
}

/// Builds a command that runs `program` inside a distribution without a shell.
pub fn exec_command(distro: &str) -> Command {
   let mut command = Command::new(WSL_EXE);
   command.args(["--distribution", distro.trim(), "--exec"]);
   hide_console_window(&mut command);
   command
}

/// Sets an environment variable on a `wsl.exe` command and lists it in
/// `WSLENV` so the Linux process receives it too.
pub fn forward_env(command: &mut Command, key: &str, value: impl AsRef<OsStr>) {
   command.env(key, value);

   let current = command
      .get_envs()
      .find(|(name, _)| *name == OsStr::new(WSLENV))
      .and_then(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
      .or_else(|| std::env::var(WSLENV).ok())
      .unwrap_or_default();
   let already_listed = current
      .split(':')
      .any(|entry| entry.split('/').next() == Some(key));
   if already_listed {
      return;
   }

   let merged = if current.is_empty() {
      key.to_string()
   } else {
      format!("{current}:{key}")
   };
   command.env(WSLENV, merged);
}

fn git_probe_cache() -> &'static Mutex<HashMap<String, (bool, Instant)>> {
   static CACHE: OnceLock<Mutex<HashMap<String, (bool, Instant)>>> = OnceLock::new();
   CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Reports whether `git` is installed inside a distribution. A positive result
/// is cached for the process lifetime; a negative one is retried periodically.
pub fn git_available(distro: &str) -> bool {
   if !cfg!(target_os = "windows") {
      return false;
   }

   let key = distro.trim().to_ascii_lowercase();
   if let Some((available, checked_at)) = git_probe_cache()
      .lock()
      .ok()
      .and_then(|cache| cache.get(&key).copied())
      && (available || checked_at.elapsed() < GIT_PROBE_RETRY_INTERVAL)
   {
      return available;
   }

   let available = exec_command(distro)
      .args(["git", "--version"])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .map(|status| status.success())
      .unwrap_or(false);
   if let Ok(mut cache) = git_probe_cache().lock() {
      cache.insert(key, (available, Instant::now()));
   }
   available
}

/// Converts a path argument so a process inside `distro` can use it: `wsl://`
/// and share paths become Linux paths and drive paths become `/mnt` paths.
/// Anything else, including relative and Linux paths, is passed through.
pub fn linux_argument_path(distro: &str, path: &str) -> String {
   let trimmed = path.trim();
   if let Some(location) = parse_wsl_location(trimmed) {
      if location.distro.eq_ignore_ascii_case(distro.trim()) {
         return location.linux_path;
      }
      return trimmed.to_string();
   }

   windows_path_to_wsl_path(trimmed).unwrap_or_else(|| trimmed.to_string())
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
   use std::os::windows::process::CommandExt;
   command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {
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
   let mut command = Command::new(WSL_EXE);
   command.args(args);
   hide_console_window(&mut command);
   let output = command
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
   hide_console_window(&mut command);
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
   if bytes.len() >= 2 && bytes.len().is_multiple_of(2) {
      let pairs = bytes.as_chunks::<2>().0;
      let odd_zero_count = pairs.iter().filter(|pair| pair[1] == 0).count();

      if odd_zero_count > bytes.len() / 4 {
         let utf16 = pairs
            .iter()
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
      assert_eq!(
         windows_unc_to_wsl_uri(r"\\wsl$\Ubuntu\home\me\repo").as_deref(),
         Some("wsl://Ubuntu/home/me/repo")
      );
   }

   #[test]
   fn parses_every_spelling_of_a_wsl_share_path() {
      let expected = WslPath {
         distro: "Ubuntu".to_string(),
         linux_path: "/home/me/repo".to_string(),
      };

      assert_eq!(
         parse_windows_unc_path(r"\\wsl$\Ubuntu\home\me\repo\"),
         Some((expected.clone(), WslUncFlavor::Legacy))
      );
      assert_eq!(
         parse_windows_unc_path("//wsl.localhost/Ubuntu/home/me/repo"),
         Some((expected.clone(), WslUncFlavor::Localhost))
      );
      assert_eq!(
         parse_windows_unc_path(r"\\?\UNC\wsl$\Ubuntu\home\me\repo"),
         Some((expected.clone(), WslUncFlavor::Legacy))
      );
      assert_eq!(
         parse_windows_unc_path(r"\\WSL.LOCALHOST\Ubuntu"),
         Some((
            WslPath {
               distro: "Ubuntu".to_string(),
               linux_path: "/".to_string(),
            },
            WslUncFlavor::Localhost
         ))
      );
      assert_eq!(parse_windows_unc_path(r"\\server\share\repo"), None);
      assert_eq!(parse_windows_unc_path(r"\\wsl$\"), None);
      assert_eq!(parse_windows_unc_path(r"C:\Users\me\repo"), None);
   }

   #[test]
   fn recognizes_wsl_locations_in_both_forms() {
      assert_eq!(
         parse_wsl_location("wsl://Ubuntu/home/me").map(|p| p.linux_path),
         Some("/home/me".to_string())
      );
      assert_eq!(
         parse_wsl_location(r"\\wsl$\Ubuntu\home\me").map(|p| p.distro),
         Some("Ubuntu".to_string())
      );
      assert_eq!(parse_wsl_location("/home/me"), None);
      assert_eq!(parse_wsl_location(r"C:\repo"), None);
   }

   #[test]
   fn converts_path_arguments_for_the_target_distribution() {
      assert_eq!(
         linux_argument_path("Ubuntu", "wsl://Ubuntu/home/me/worktree"),
         "/home/me/worktree"
      );
      assert_eq!(
         linux_argument_path("Ubuntu", r"\\wsl.localhost\Ubuntu\home\me\worktree"),
         "/home/me/worktree"
      );
      assert_eq!(
         linux_argument_path("Ubuntu", r"C:\Users\me\worktree"),
         "/mnt/c/Users/me/worktree"
      );
      assert_eq!(
         linux_argument_path("Ubuntu", "/home/me/worktree"),
         "/home/me/worktree"
      );
      assert_eq!(linux_argument_path("Ubuntu", "../worktree"), "../worktree");
      assert_eq!(
         linux_argument_path("Ubuntu", "wsl://Debian/home/me/worktree"),
         "wsl://Debian/home/me/worktree"
      );
   }

   #[test]
   fn forwards_environment_variables_through_wslenv() {
      let mut command = Command::new("true");
      command.env(WSLENV, "EXISTING/p");
      forward_env(&mut command, "GIT_TERMINAL_PROMPT", "0");
      forward_env(&mut command, "GIT_SSH_COMMAND", "ssh -oBatchMode=yes");
      forward_env(&mut command, "GIT_TERMINAL_PROMPT", "0");

      let envs: HashMap<String, String> = command
         .get_envs()
         .filter_map(|(key, value)| {
            Some((
               key.to_string_lossy().into_owned(),
               value?.to_string_lossy().into_owned(),
            ))
         })
         .collect();

      assert_eq!(
         envs.get(WSLENV).map(String::as_str),
         Some("EXISTING/p:GIT_TERMINAL_PROMPT:GIT_SSH_COMMAND")
      );
      assert_eq!(
         envs.get("GIT_TERMINAL_PROMPT").map(String::as_str),
         Some("0")
      );
   }

   #[test]
   fn exec_command_targets_the_distribution_without_a_shell() {
      let command = exec_command("Ubuntu");
      let args: Vec<String> = command
         .get_args()
         .map(|arg| arg.to_string_lossy().into_owned())
         .collect();

      assert_eq!(command.get_program(), OsStr::new(WSL_EXE));
      assert_eq!(args, vec!["--distribution", "Ubuntu", "--exec"]);
   }

   #[test]
   fn unc_flavor_defaults_to_localhost_off_windows() {
      assert_eq!(resolve_unc_flavor("Ubuntu"), WslUncFlavor::Localhost);
   }
}
