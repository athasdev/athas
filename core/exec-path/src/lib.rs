use std::{
   env, fs,
   io::{Read, Seek, SeekFrom},
   path::{Path, PathBuf},
   process::{Command, Output, Stdio},
   sync::OnceLock,
   time::{Duration, Instant},
};

pub fn probe_command(command: &mut Command, timeout: Duration) -> std::io::Result<Output> {
   let mut stdout = tempfile::tempfile()?;
   let mut stderr = tempfile::tempfile()?;
   command
      .stdin(Stdio::null())
      .stdout(stdout.try_clone()?)
      .stderr(stderr.try_clone()?);
   #[cfg(unix)]
   {
      use std::os::unix::process::CommandExt;
      command.process_group(0);
   }
   #[cfg(windows)]
   {
      use std::os::windows::process::CommandExt;
      command.creation_flags(0x08000000);
   }
   let mut child = command.spawn()?;
   let deadline = Instant::now() + timeout;
   loop {
      if let Some(status) = child.try_wait()? {
         stdout.seek(SeekFrom::Start(0))?;
         stderr.seek(SeekFrom::Start(0))?;
         let mut output = Output {
            status,
            stdout: Vec::new(),
            stderr: Vec::new(),
         };
         stdout.take(64 * 1024).read_to_end(&mut output.stdout)?;
         stderr.take(64 * 1024).read_to_end(&mut output.stderr)?;
         return Ok(output);
      }
      if Instant::now() >= deadline {
         #[cfg(unix)]
         unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
         }
         let _ = child.kill();
         let _ = child.wait();
         return Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "Executable discovery timed out",
         ));
      }
      std::thread::sleep(Duration::from_millis(20));
   }
}

pub fn user_shell_path() -> Option<&'static str> {
   static CACHED: OnceLock<Option<String>> = OnceLock::new();
   CACHED
      .get_or_init(|| {
         if cfg!(target_os = "windows") {
            return None;
         }
         let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
         let output = probe_command(
            Command::new(&shell).args(["-ilc", "printf '\nATHAS_PATH=%s\n' \"$PATH\""]),
            Duration::from_secs(2),
         )
         .ok()?;
         let text = String::from_utf8(output.stdout).ok()?;
         let path = text
            .lines()
            .find_map(|line| line.strip_prefix("ATHAS_PATH="))?
            .to_string();
         if path.is_empty() { None } else { Some(path) }
      })
      .as_deref()
}

pub fn find_executable(binary_name: &str) -> Option<PathBuf> {
   if let Ok(path) = which::which(binary_name) {
      return Some(path);
   }

   let mut candidates = Vec::new();
   if let Some(paths) = env::var_os("PATH") {
      candidates.extend(env::split_paths(&paths));
   }
   if let Some(shell_path) = user_shell_path() {
      candidates.extend(env::split_paths(&std::ffi::OsString::from(shell_path)));
   }

   if let Some(home) = env::var_os("HOME") {
      let home = PathBuf::from(home);
      candidates.extend([
         home.join(".local/bin"),
         home.join(".npm-global/bin"),
         home.join(".yarn/bin"),
         home.join(".config/yarn/global/node_modules/.bin"),
         home.join(".bun/bin"),
         home.join(".pnpm"),
         home.join("Library/pnpm"),
         home.join("Library/pnpm/bin"),
         home.join(".cargo/bin"),
         home.join("go/bin"),
         home.join(".asdf/shims"),
         home.join(".local/share/mise/shims"),
      ]);
      add_version_manager_bins(
         &mut candidates,
         &home.join(".local/share/mise/installs/node"),
      );
      add_version_manager_bins(&mut candidates, &home.join(".asdf/installs/nodejs"));
      add_version_manager_bins(&mut candidates, &home.join(".nvm/versions/node"));
   }

   candidates.extend([
      PathBuf::from("/usr/local/bin"),
      PathBuf::from("/opt/homebrew/bin"),
      PathBuf::from("/usr/bin"),
      PathBuf::from("/bin"),
      PathBuf::from("/opt/local/bin"),
   ]);

   if let Ok(cwd) = env::current_dir() {
      candidates.push(cwd.join("node_modules/.bin"));
   }
   for variable in ["PNPM_HOME", "NVM_BIN", "GOBIN"] {
      if let Some(dir) = env::var_os(variable) {
         candidates.push(PathBuf::from(dir));
      }
   }
   for variable in ["BUN_INSTALL", "VOLTA_HOME", "GOPATH", "CARGO_HOME"] {
      if let Some(dir) = env::var_os(variable) {
         candidates.push(PathBuf::from(dir).join("bin"));
      }
   }
   if let Some(dir) = env::var_os("MISE_DATA_DIR") {
      add_version_manager_bins(&mut candidates, &PathBuf::from(dir).join("installs/node"));
   }
   if let Some(dir) = env::var_os("ASDF_DATA_DIR") {
      add_version_manager_bins(&mut candidates, &PathBuf::from(dir).join("installs/nodejs"));
   }

   candidates
      .into_iter()
      .find_map(|dir| check_dir_for_binary(&dir, binary_name))
}

fn add_version_manager_bins(candidates: &mut Vec<PathBuf>, root: &Path) {
   if let Ok(entries) = fs::read_dir(root) {
      for entry in entries.flatten() {
         candidates.push(entry.path().join("bin"));
      }
   }
}

fn check_dir_for_binary(dir: &Path, binary_name: &str) -> Option<PathBuf> {
   #[cfg(target_os = "windows")]
   {
      let lowercase_name = binary_name.to_ascii_lowercase();
      let mut candidate_names = vec![binary_name.to_string()];
      for extension in [".exe", ".cmd", ".bat", ".ps1"] {
         if !lowercase_name.ends_with(extension) {
            candidate_names.push(format!("{binary_name}{extension}"));
         }
      }
      return candidate_names
         .into_iter()
         .map(|name| dir.join(name))
         .find(|candidate| candidate.is_file());
   }

   #[cfg(not(target_os = "windows"))]
   {
      let candidate = dir.join(binary_name);
      candidate.is_file().then_some(candidate)
   }
}

#[cfg(test)]
mod tests {
   use super::check_dir_for_binary;
   #[cfg(unix)]
   use super::probe_command;
   use std::fs;
   #[cfg(unix)]
   use std::{
      process::Command,
      time::{Duration, Instant},
   };

   #[test]
   #[cfg(unix)]
   fn times_out_unresponsive_discovery_commands() {
      let start = Instant::now();
      let result = probe_command(
         Command::new("/bin/sh").args(["-c", "sleep 30"]),
         Duration::from_millis(100),
      );
      assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
      assert!(start.elapsed() < Duration::from_secs(2));
   }

   #[test]
   #[cfg(unix)]
   fn captures_probe_output_without_waiting_for_inherited_pipes() {
      let output = probe_command(
         Command::new("/bin/sh").args(["-c", "printf '1.2.3'; printf 'warning' >&2"]),
         Duration::from_secs(2),
      )
      .unwrap();
      assert!(output.status.success());
      assert_eq!(output.stdout, b"1.2.3");
      assert_eq!(output.stderr, b"warning");
   }

   #[test]
   fn finds_an_executable_in_a_candidate_directory() {
      let directory = tempfile::tempdir().expect("temp dir");
      let file_name = if cfg!(windows) {
         "test-agent.cmd"
      } else {
         "test-agent"
      };
      let binary = directory.path().join(file_name);
      fs::write(&binary, "test").expect("write binary");

      assert_eq!(
         check_dir_for_binary(directory.path(), "test-agent"),
         Some(binary)
      );
   }

   #[test]
   fn returns_none_for_a_missing_executable() {
      let directory = tempfile::tempdir().expect("temp dir");
      assert!(check_dir_for_binary(directory.path(), "missing").is_none());
   }
}
