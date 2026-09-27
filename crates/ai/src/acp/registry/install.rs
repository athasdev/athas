//! Installs registry agents into versioned directories and points a launcher script at the
//! active version.
//!
//! Layout, for an agent `<id>`:
//! - `<agents_root>/<id>/<version>-<key>/`: one complete install per version. Directories are built
//!   under a `.staging-*` name and renamed into place, so a version directory that exists is
//!   complete.
//! - `<launcher_dir>/<id>` (`<id>.cmd` on Windows): the script Athas starts, rewritten atomically
//!   to switch versions, next to `<id>.json` with the installed version.
//!
//! Binary downloads are checked against the registry's SHA-256 before they are unpacked, and
//! nothing from an install is run before that check passes.

use super::{archive, store::write_atomically};
use sha2::{Digest, Sha256};
use std::{
   fs::{self, File},
   io::{self, Read, Write},
   path::{Path, PathBuf},
   process::Command,
   time::Duration,
};

/// Agent builds larger than this are refused.
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// A version directory name: the version, made safe for a path, and a short hash of what was
/// installed (the archive URL and checksum, or the npm package), so a re-published version with
/// a new checksum gets its own directory.
pub fn version_dir_name(version: &str, key: &str) -> String {
   let version = version
      .chars()
      .map(|c| {
         if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+') {
            c
         } else {
            '_'
         }
      })
      .collect::<String>();
   let digest = Sha256::digest(key.as_bytes());
   let hash = digest
      .iter()
      .take(6)
      .map(|byte| format!("{byte:02x}"))
      .collect::<String>();
   format!("{}-{hash}", version.trim_start_matches('.'))
}

fn sha256_file(path: &Path) -> io::Result<String> {
   let mut file = File::open(path)?;
   let mut hasher = Sha256::new();
   let mut buffer = [0u8; 64 * 1024];
   loop {
      let read = file.read(&mut buffer)?;
      if read == 0 {
         break;
      }
      hasher.update(&buffer[..read]);
   }
   Ok(hasher
      .finalize()
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect())
}

/// Fails unless the file's SHA-256 is `expected` (hex, any case).
pub fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
   let actual =
      sha256_file(path).map_err(|error| format!("Failed to hash the download: {error}"))?;
   if actual.eq_ignore_ascii_case(expected.trim()) {
      Ok(())
   } else {
      Err(format!(
         "The download does not match the registry checksum (expected {expected}, got {actual})"
      ))
   }
}

fn unique_suffix() -> String {
   uuid::Uuid::new_v4().simple().to_string()
}

/// Removes every version directory and leftover staging file in `agent_dir` except `keep`.
/// Returns what it removed. Files that are still in use (a running agent on Windows) are left
/// for the next update.
pub fn remove_stale_versions(agent_dir: &Path, keep: &str) -> Vec<PathBuf> {
   let Ok(entries) = fs::read_dir(agent_dir) else {
      return Vec::new();
   };
   entries
      .filter_map(Result::ok)
      .filter(|entry| entry.file_name() != keep)
      .filter_map(|entry| {
         let path = entry.path();
         let result = if path.is_dir() {
            fs::remove_dir_all(&path)
         } else {
            fs::remove_file(&path)
         };
         match result {
            Ok(()) => Some(path),
            Err(error) => {
               log::warn!("Could not remove old agent version {path:?}: {error}");
               None
            }
         }
      })
      .collect()
}

/// Moves a finished staging directory to `final_dir`. When another install already produced
/// `final_dir`, that one is kept.
fn promote(staging: &Path, final_dir: &Path) -> Result<(), String> {
   match fs::rename(staging, final_dir) {
      Ok(()) => Ok(()),
      Err(_) if final_dir.is_dir() => {
         let _ = fs::remove_dir_all(staging);
         Ok(())
      }
      Err(error) => {
         let _ = fs::remove_dir_all(staging);
         Err(format!("Failed to move the install into place: {error}"))
      }
   }
}

/// Resolves the registry's `cmd` inside an install directory.
pub fn resolve_command(install_dir: &Path, cmd: &str) -> Result<PathBuf, String> {
   let relative = archive::safe_relative_path(cmd)
      .ok_or_else(|| format!("The registry command {cmd:?} points outside the install"))?;
   let path = install_dir.join(relative);
   if !path.is_file() {
      return Err(format!(
         "The registry command {cmd:?} is missing from the download"
      ));
   }
   // A symlink inside the archive may still point elsewhere once resolved.
   let canonical_dir = install_dir
      .canonicalize()
      .map_err(|error| error.to_string())?;
   let canonical = path.canonicalize().map_err(|error| error.to_string())?;
   if !canonical.starts_with(&canonical_dir) {
      return Err(format!(
         "The registry command {cmd:?} points outside the install"
      ));
   }
   Ok(path)
}

fn make_executable(path: &Path) -> io::Result<()> {
   #[cfg(unix)]
   {
      use std::os::unix::fs::PermissionsExt;
      let mut permissions = fs::metadata(path)?.permissions();
      permissions.set_mode(permissions.mode() | 0o755);
      fs::set_permissions(path, permissions)?;
   }
   #[cfg(not(unix))]
   let _ = path;
   Ok(())
}

async fn download(client: &reqwest::Client, url: &str, destination: &Path) -> Result<(), String> {
   if !url.starts_with("https://") {
      return Err("Agent downloads must use HTTPS".to_string());
   }
   let mut response = client
      .get(url)
      .timeout(DOWNLOAD_TIMEOUT)
      .send()
      .await
      .map_err(|error| format!("Download failed: {error}"))?;
   if !response.status().is_success() {
      return Err(format!("Download failed: HTTP {}", response.status()));
   }
   if response
      .content_length()
      .is_some_and(|length| length > MAX_DOWNLOAD_BYTES)
   {
      return Err("The download is too large".to_string());
   }
   let mut file =
      File::create(destination).map_err(|error| format!("Failed to save the download: {error}"))?;
   let mut written: u64 = 0;
   while let Some(chunk) = response
      .chunk()
      .await
      .map_err(|error| format!("Download failed: {error}"))?
   {
      written += chunk.len() as u64;
      if written > MAX_DOWNLOAD_BYTES {
         return Err("The download is too large".to_string());
      }
      file
         .write_all(&chunk)
         .map_err(|error| format!("Failed to save the download: {error}"))?;
   }
   file
      .sync_all()
      .map_err(|error| format!("Failed to save the download: {error}"))
}

/// Checks a download against the registry checksum and only then unpacks it into `staging`.
fn unpack_verified(
   download: &Path,
   sha256: &str,
   archive_url: &str,
   cmd: &str,
   staging: &Path,
) -> Result<(), String> {
   verify_sha256(download, sha256)?;
   fs::create_dir_all(staging).map_err(|error| error.to_string())?;
   let kind = archive::archive_kind(archive_url);
   archive::extract(download, kind, staging, cmd)
      .map_err(|error| format!("Failed to unpack the download: {error}"))?;
   let executable = resolve_command(staging, cmd)?;
   make_executable(&executable).map_err(|error| error.to_string())
}

/// Downloads, verifies and unpacks a binary build into its version directory under
/// `agent_dir`, reusing it when it is already there. Returns the version directory's name and
/// the executable.
pub async fn install_binary(
   client: &reqwest::Client,
   agent_dir: &Path,
   version: &str,
   archive_url: &str,
   sha256: &str,
   cmd: &str,
) -> Result<(String, PathBuf), String> {
   let dir_name = version_dir_name(version, &format!("{archive_url}\n{sha256}"));
   let final_dir = agent_dir.join(&dir_name);
   if final_dir.is_dir()
      && let Ok(executable) = resolve_command(&final_dir, cmd)
   {
      return Ok((dir_name, executable));
   }

   fs::create_dir_all(agent_dir)
      .map_err(|error| format!("Failed to create {agent_dir:?}: {error}"))?;
   let suffix = unique_suffix();
   let download_path = agent_dir.join(format!(".download-{suffix}"));
   let staging = agent_dir.join(format!(".staging-{suffix}"));

   let result = async {
      download(client, archive_url, &download_path).await?;
      unpack_verified(&download_path, sha256, archive_url, cmd, &staging)
   }
   .await;
   let _ = fs::remove_file(&download_path);
   if let Err(error) = result {
      let _ = fs::remove_dir_all(&staging);
      return Err(error);
   }

   promote(&staging, &final_dir)?;
   let executable = resolve_command(&final_dir, cmd)?;
   Ok((dir_name, executable))
}

/// The JavaScript file a package's `bin` field names: the only entry, or the one named like the
/// package, or the first.
pub fn resolve_npm_bin(package_root: &Path, package_name: &str) -> Result<PathBuf, String> {
   let manifest = fs::read_to_string(package_root.join("package.json"))
      .map_err(|error| format!("Failed to read the installed package.json: {error}"))?;
   let manifest: serde_json::Value =
      serde_json::from_str(&manifest).map_err(|error| error.to_string())?;
   let unscoped = package_name.rsplit('/').next().unwrap_or(package_name);
   let bin = match manifest.get("bin") {
      Some(serde_json::Value::String(path)) => path.clone(),
      Some(serde_json::Value::Object(bins)) => bins
         .get(unscoped)
         .or_else(|| bins.values().next())
         .and_then(|value| value.as_str())
         .map(ToString::to_string)
         .ok_or_else(|| format!("{package_name} declares no executable"))?,
      _ => return Err(format!("{package_name} declares no executable")),
   };
   resolve_command(package_root, &bin)
}

/// Installs `name@version` with npm into its own version directory under `agent_dir`, pinned
/// exactly, and returns the version directory's name and the package's entry script.
pub fn install_npm(
   node: &Path,
   npm_cli: &Path,
   agent_dir: &Path,
   name: &str,
   version: &str,
) -> Result<(String, PathBuf), String> {
   let dir_name = version_dir_name(version, name);
   let final_dir = agent_dir.join(&dir_name);
   let package_root = |dir: &Path| dir.join("node_modules").join(name);
   if final_dir.is_dir()
      && let Ok(entry) = resolve_npm_bin(&package_root(&final_dir), name)
   {
      return Ok((dir_name, entry));
   }

   fs::create_dir_all(agent_dir)
      .map_err(|error| format!("Failed to create {agent_dir:?}: {error}"))?;
   let staging = agent_dir.join(format!(".staging-{}", unique_suffix()));
   let result = (|| {
      fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
      fs::write(
         staging.join("package.json"),
         r#"{ "name": "athas-acp-agent", "private": true }"#,
      )
      .map_err(|error| error.to_string())?;

      let mut command = Command::new(node);
      command
         .arg(npm_cli)
         .args([
            "install",
            "--save-exact",
            "--no-audit",
            "--no-fund",
            "--no-update-notifier",
         ])
         .arg(format!("{name}@{version}"))
         .current_dir(&staging);
      if let Some(bin_dir) = node.parent() {
         let mut paths = vec![bin_dir.to_path_buf()];
         paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
         ));
         if let Ok(path) = std::env::join_paths(paths) {
            command.env("PATH", path);
         }
      }
      let output = command
         .output()
         .map_err(|error| format!("npm could not start: {error}"))?;
      if !output.status.success() {
         return Err(format!(
            "npm install failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
         ));
      }
      resolve_npm_bin(&package_root(&staging), name).map(|_| ())
   })();
   if let Err(error) = result {
      let _ = fs::remove_dir_all(&staging);
      return Err(error);
   }

   promote(&staging, &final_dir)?;
   let entry = resolve_npm_bin(&package_root(&final_dir), name)?;
   Ok((dir_name, entry))
}

/// The launcher script's file name for `agent_id`.
pub fn launcher_file_name(agent_id: &str) -> String {
   if cfg!(windows) {
      format!("{agent_id}.cmd")
   } else {
      agent_id.to_string()
   }
}

fn posix_quote(word: &str) -> String {
   format!("'{}'", word.replace('\'', r#"'\''"#))
}

fn cmd_quote(word: &str) -> Result<String, String> {
   if word.contains(['"', '\r', '\n']) {
      return Err(format!(
         "{word:?} cannot be passed through a Windows launcher"
      ));
   }
   Ok(format!("\"{}\"", word.replace('%', "%%")))
}

/// A script that runs `program` with `leading_args`, then whatever Athas passes.
pub fn launcher_script(program: &Path, leading_args: &[String]) -> Result<String, String> {
   let program = program.to_string_lossy();
   if cfg!(windows) {
      let mut words = vec![cmd_quote(&program)?];
      for arg in leading_args {
         words.push(cmd_quote(arg)?);
      }
      Ok(format!("@echo off\r\n{} %*\r\n", words.join(" ")))
   } else {
      let mut words = vec![posix_quote(&program)];
      words.extend(leading_args.iter().map(|arg| posix_quote(arg)));
      Ok(format!("#!/bin/sh\nexec {} \"$@\"\n", words.join(" ")))
   }
}

/// Points the agent's launcher at an installed version and records the version, replacing both
/// files atomically.
pub fn write_launcher(
   launcher_dir: &Path,
   agent_id: &str,
   program: &Path,
   leading_args: &[String],
   metadata: &serde_json::Value,
) -> Result<PathBuf, String> {
   fs::create_dir_all(launcher_dir)
      .map_err(|error| format!("Failed to create {launcher_dir:?}: {error}"))?;
   let launcher = launcher_dir.join(launcher_file_name(agent_id));
   let script = launcher_script(program, leading_args)?;
   let temp = launcher_dir.join(format!(".{agent_id}.{}", unique_suffix()));
   fs::write(&temp, script).map_err(|error| format!("Failed to write the launcher: {error}"))?;
   make_executable(&temp).map_err(|error| error.to_string())?;
   fs::rename(&temp, &launcher).map_err(|error| {
      let _ = fs::remove_file(&temp);
      format!("Failed to write the launcher: {error}")
   })?;
   let metadata = serde_json::to_vec_pretty(metadata).map_err(|error| error.to_string())?;
   write_atomically(&launcher_dir.join(format!("{agent_id}.json")), &metadata)?;
   Ok(launcher)
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn version_directories_are_path_safe_and_keyed() {
      let name = version_dir_name("1.2.3", "https://x/a.zip\nabc");
      assert!(name.starts_with("1.2.3-"));
      assert_ne!(name, version_dir_name("1.2.3", "https://x/a.zip\ndef"));
      assert!(!version_dir_name("../1", "k").contains('/'));
   }

   #[test]
   fn verifies_sha256() {
      let file = tempfile::NamedTempFile::new().unwrap();
      fs::write(file.path(), b"hello").unwrap();
      let hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
      assert!(verify_sha256(file.path(), hello).is_ok());
      assert!(verify_sha256(file.path(), &hello.to_uppercase()).is_ok());
      let error = verify_sha256(file.path(), &"0".repeat(64)).unwrap_err();
      assert!(error.contains("does not match"), "{error}");
   }

   #[test]
   fn a_download_with_the_wrong_checksum_is_never_unpacked() {
      let download = tempfile::NamedTempFile::new().unwrap();
      fs::write(download.path(), b"tampered").unwrap();
      let root = tempfile::tempdir().unwrap();
      let staging = root.path().join(".staging");

      let error = unpack_verified(
         download.path(),
         &"0".repeat(64),
         "https://example.com/agent",
         "./agent",
         &staging,
      )
      .unwrap_err();

      assert!(error.contains("checksum"), "{error}");
      assert!(!staging.exists());
   }

   #[test]
   fn a_verified_raw_download_becomes_an_executable() {
      let download = tempfile::NamedTempFile::new().unwrap();
      fs::write(download.path(), b"hello").unwrap();
      let root = tempfile::tempdir().unwrap();
      let staging = root.path().join(".staging");
      let hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

      unpack_verified(
         download.path(),
         hello,
         "https://example.com/agent",
         "./agent",
         &staging,
      )
      .unwrap();

      assert!(staging.join("agent").is_file());
   }

   #[test]
   fn removes_every_version_but_the_active_one() {
      let dir = tempfile::tempdir().unwrap();
      for name in ["1.0.0-aaaa", "1.1.0-bbbb", "2.0.0-cccc"] {
         fs::create_dir(dir.path().join(name)).unwrap();
         fs::write(dir.path().join(name).join("agent"), "x").unwrap();
      }
      fs::write(dir.path().join(".download-left-over"), "x").unwrap();

      let removed = remove_stale_versions(dir.path(), "2.0.0-cccc");

      assert_eq!(removed.len(), 3);
      let remaining = fs::read_dir(dir.path())
         .unwrap()
         .map(|entry| entry.unwrap().file_name().into_string().unwrap())
         .collect::<Vec<_>>();
      assert_eq!(remaining, vec!["2.0.0-cccc".to_string()]);
   }

   #[test]
   fn commands_must_exist_inside_the_install() {
      let dir = tempfile::tempdir().unwrap();
      fs::create_dir(dir.path().join("bin")).unwrap();
      fs::write(dir.path().join("bin/agent"), "x").unwrap();
      assert!(resolve_command(dir.path(), "./bin/agent").is_ok());
      assert!(resolve_command(dir.path(), "./bin/missing").is_err());
      assert!(resolve_command(dir.path(), "../agent").is_err());
   }

   #[cfg(unix)]
   #[test]
   fn commands_may_not_escape_through_symlinks() {
      let outside = tempfile::tempdir().unwrap();
      fs::write(outside.path().join("agent"), "x").unwrap();
      let dir = tempfile::tempdir().unwrap();
      std::os::unix::fs::symlink(outside.path().join("agent"), dir.path().join("agent")).unwrap();
      assert!(resolve_command(dir.path(), "./agent").is_err());
   }

   #[test]
   fn resolves_npm_bins() {
      let dir = tempfile::tempdir().unwrap();
      fs::create_dir(dir.path().join("dist")).unwrap();
      fs::write(dir.path().join("dist/index.js"), "").unwrap();
      fs::write(
         dir.path().join("package.json"),
         r#"{ "bin": { "other": "missing.js", "claude-agent-acp": "dist/index.js" } }"#,
      )
      .unwrap();
      let entry = resolve_npm_bin(dir.path(), "@agentclientprotocol/claude-agent-acp").unwrap();
      assert!(entry.ends_with("dist/index.js"));

      fs::write(
         dir.path().join("package.json"),
         r#"{ "bin": "../escape.js" }"#,
      )
      .unwrap();
      assert!(resolve_npm_bin(dir.path(), "pkg").is_err());
   }

   #[test]
   fn launchers_quote_their_arguments() {
      let script = launcher_script(Path::new("/opt/it's/agent"), &["a b".to_string()]).unwrap();
      if cfg!(windows) {
         assert!(script.contains("\"a b\" %*"));
      } else {
         assert_eq!(
            script,
            "#!/bin/sh\nexec '/opt/it'\\''s/agent' 'a b' \"$@\"\n"
         );
      }
   }

   #[test]
   fn writes_the_launcher_and_version_metadata() {
      let dir = tempfile::tempdir().unwrap();
      let launcher = write_launcher(
         dir.path(),
         "goose",
         Path::new("/opt/goose"),
         &[],
         &serde_json::json!({ "version": "1.52.0" }),
      )
      .unwrap();
      assert!(launcher.is_file());
      let metadata = fs::read_to_string(dir.path().join("goose.json")).unwrap();
      assert!(metadata.contains("1.52.0"));
      let leftovers = fs::read_dir(dir.path())
         .unwrap()
         .filter(|entry| {
            entry
               .as_ref()
               .unwrap()
               .file_name()
               .to_string_lossy()
               .starts_with('.')
         })
         .count();
      assert_eq!(leftovers, 0);
   }
}
