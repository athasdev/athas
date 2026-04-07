use std::{
   env,
   ffi::OsStr,
   path::{Path, PathBuf},
   process::Command,
};
use tauri::{AppHandle, Manager};

/// Resolve the `gh` binary, checking well-known install locations that may be
/// absent from the restricted PATH inherited by bundled .app launches.
fn resolve_gh_binary() -> String {
   // First check if `gh` is already on PATH
   if let Ok(paths) = env::var("PATH") {
      for dir in env::split_paths(&paths) {
         if dir.join("gh").exists() {
            return "gh".to_string();
         }
      }
   }

   // Common install locations (Homebrew Apple Silicon, Homebrew Intel, Nix)
   let candidates = [
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
      "/run/current-system/sw/bin/gh",
   ];

   for path in &candidates {
      if Path::new(path).exists() {
         return path.to_string();
      }
   }

   // Fall back to bare name and let the OS try
   "gh".to_string()
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
