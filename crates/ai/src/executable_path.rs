use std::{
   env, fs,
   path::{Path, PathBuf},
   process::Command,
   sync::OnceLock,
};

pub(crate) fn user_shell_path() -> Option<&'static str> {
   static CACHED: OnceLock<Option<String>> = OnceLock::new();
   CACHED
      .get_or_init(|| {
         if cfg!(target_os = "windows") {
            return None;
         }
         let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
         let output = Command::new(&shell)
            .args(["-ilc", "echo $PATH"])
            .output()
            .ok()?;
         let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
         if path.is_empty() { None } else { Some(path) }
      })
      .as_deref()
}

pub(crate) fn find_executable(binary_name: &str) -> Option<PathBuf> {
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
   use std::fs;

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
