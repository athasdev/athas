use std::{
   env,
   ffi::OsStr,
   path::{Path, PathBuf},
   process::Command,
   sync::OnceLock,
};
use tauri::{AppHandle, Manager};

/// Get the user's login shell PATH by running `$SHELL -ilc 'echo $PATH'`.
/// Cached for the lifetime of the process since the user's PATH doesn't change.
fn user_shell_path() -> Option<&'static str> {
   static CACHED: OnceLock<Option<String>> = OnceLock::new();
   CACHED
      .get_or_init(|| {
         let shell = env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
               return String::new();
            }
            "/bin/zsh".to_string()
         });
         if shell.is_empty() {
            return None;
         }
         let output = Command::new(&shell)
            .args(["-ilc", "echo $PATH"])
            .output()
            .ok()?;
         let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
         if path.is_empty() { None } else { Some(path) }
      })
      .as_deref()
}

/// Find the `gh` binary. On bundled apps the inherited PATH is minimal,
/// so we resolve the full PATH from the user's login shell first.
pub(crate) fn resolve_gh_binary() -> String {
   let exe = if cfg!(target_os = "windows") {
      "gh.exe"
   } else {
      "gh"
   };

   // Combine current PATH with the user's shell PATH
   let combined = match (env::var("PATH").ok(), user_shell_path()) {
      (Some(current), Some(shell)) => format!("{current}:{shell}"),
      (Some(current), None) => current,
      (None, Some(shell)) => shell.to_string(),
      (None, None) => String::new(),
   };

   for dir in env::split_paths(&combined) {
      if dir.join(exe).exists() {
         return dir.join(exe).to_string_lossy().into_owned();
      }
   }

   // Fall back to bare name and let the OS try
   exe.to_string()
}

pub(crate) fn gh_command(app: &AppHandle, repo_dir: Option<&Path>) -> Command {
   let mut command = Command::new(resolve_gh_binary());

   if let Some(dir) = repo_dir {
      command.current_dir(dir);
   }

   let has_explicit_config_dir =
      matches!(env::var_os("GH_CONFIG_DIR"), Some(dir) if !dir.is_empty());

   if !has_explicit_config_dir && let Some(config_dir) = resolve_gh_config_dir(app) {
      command.env("GH_CONFIG_DIR", config_dir);
   }

   command
}

pub(crate) fn get_github_username(app: &AppHandle) -> Result<String, String> {
   let output = gh_command(app, None)
      .args(["api", "user", "--jq", ".login"])
      .output()
      .map_err(|e| format!("Failed to get GitHub username: {}", e))?;

   if !output.status.success() {
      return Err("Not authenticated with GitHub CLI".to_string());
   }

   Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn resolve_gh_config_dir(app: &AppHandle) -> Option<PathBuf> {
   let home_dir = app.path().home_dir().ok();
   resolve_gh_config_dir_from_sources(
      env::var_os("GH_CONFIG_DIR").as_deref(),
      env::var_os("XDG_CONFIG_HOME").as_deref(),
      env::var_os("APPDATA").as_deref(),
      home_dir.as_deref(),
      cfg!(target_os = "windows"),
   )
}

pub(crate) fn resolve_gh_config_dir_from_sources(
   gh_config_dir: Option<&OsStr>,
   xdg_config_home: Option<&OsStr>,
   app_data: Option<&OsStr>,
   home_dir: Option<&Path>,
   is_windows: bool,
) -> Option<PathBuf> {
   if let Some(dir) = gh_config_dir.filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(dir));
   }

   if let Some(dir) = xdg_config_home.filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(dir).join("gh"));
   }

   if is_windows && let Some(dir) = app_data.filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(dir).join("GitHub CLI"));
   }

   home_dir.map(|dir| dir.join(".config").join("gh"))
}
