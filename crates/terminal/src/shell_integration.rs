use portable_pty::CommandBuilder;
use std::{
   collections::HashMap,
   fs, io,
   path::{Path, PathBuf},
};

/// Bump when any embedded script changes so installed copies get refreshed.
pub const SHELL_INTEGRATION_VERSION: &str = "2";

const SCRIPTS: &[(&str, &str)] = &[
   (
      "zsh/.zshenv",
      include_str!("../shell-integration/zsh/zshenv"),
   ),
   (
      "zsh/.zprofile",
      include_str!("../shell-integration/zsh/zprofile"),
   ),
   ("zsh/.zshrc", include_str!("../shell-integration/zsh/zshrc")),
   (
      "zsh/.zlogin",
      include_str!("../shell-integration/zsh/zlogin"),
   ),
   (
      "zsh/athas-shell-integration.zsh",
      include_str!("../shell-integration/zsh/athas-shell-integration.zsh"),
   ),
   (
      "bash/athas-shell-integration.bash",
      include_str!("../shell-integration/bash/athas-shell-integration.bash"),
   ),
   (
      "fish/fish/vendor_conf.d/athas-shell-integration.fish",
      include_str!("../shell-integration/fish/fish/vendor_conf.d/athas-shell-integration.fish"),
   ),
   (
      "powershell/athas-shell-integration.ps1",
      include_str!("../shell-integration/powershell/athas-shell-integration.ps1"),
   ),
];

/// Writes the embedded shell integration scripts under `base_dir` and returns
/// the versioned directory that terminals should point their shells at.
pub fn ensure_shell_integration_dir(base_dir: &Path) -> io::Result<PathBuf> {
   let dir = base_dir.join(SHELL_INTEGRATION_VERSION);

   for (relative_path, contents) in SCRIPTS {
      let path = dir.join(relative_path);
      if fs::read_to_string(&path).is_ok_and(|existing| existing == *contents) {
         continue;
      }
      if let Some(parent) = path.parent() {
         fs::create_dir_all(parent)?;
      }
      fs::write(&path, contents)?;
   }

   Ok(dir)
}

pub(crate) fn apply_shell_integration(
   cmd: &mut CommandBuilder,
   integration_dir: &Path,
   shell_path: Option<&str>,
   environment: &HashMap<String, String>,
) -> bool {
   let Some(shell_name) = shell_path.and_then(executable_name) else {
      return false;
   };
   let shell_name = shell_name
      .strip_suffix(".exe")
      .or_else(|| shell_name.strip_suffix(".EXE"))
      .unwrap_or(shell_name)
      .to_ascii_lowercase();
   let posix_shell_supported = !cfg!(target_os = "windows");
   let lookup = |key: &str| {
      environment
         .get(key)
         .cloned()
         .or_else(|| std::env::var(key).ok())
         .filter(|value| !value.is_empty())
   };

   let applied = match shell_name.as_str() {
      "pwsh" | "powershell" => {
         let script = integration_dir
            .join("powershell")
            .join("athas-shell-integration.ps1");
         if !script.is_file() {
            return false;
         }
         cmd.arg("-NoExit");
         cmd.arg("-Command");
         cmd.arg(format!(
            ". '{}'",
            script.to_string_lossy().replace('\'', "''")
         ));
         true
      }
      "zsh" if posix_shell_supported => {
         let zsh_dir = integration_dir.join("zsh");
         if !zsh_dir.join(".zshrc").is_file() {
            return false;
         }
         if let Some(user_zdotdir) = lookup("ZDOTDIR").or_else(|| lookup("HOME")) {
            cmd.env("ATHAS_USER_ZDOTDIR", user_zdotdir);
         }
         cmd.env("ZDOTDIR", &zsh_dir);
         true
      }
      "bash" => {
         let script = integration_dir
            .join("bash")
            .join("athas-shell-integration.bash");
         if !script.is_file() {
            return false;
         }
         cmd.arg("--init-file");
         cmd.arg(&script);
         // Git Bash on Windows normally starts as a login shell, which would
         // ignore --init-file; the script sources the login profile instead.
         if cfg!(target_os = "windows") {
            cmd.env("ATHAS_SHELL_LOGIN", "1");
         }
         true
      }
      "fish" if posix_shell_supported => {
         let data_dir = integration_dir.join("fish");
         if !data_dir.join("fish").join("vendor_conf.d").is_dir() {
            return false;
         }
         let existing =
            lookup("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
         cmd.env(
            "XDG_DATA_DIRS",
            format!("{}:{existing}", data_dir.display()),
         );
         true
      }
      _ => false,
   };

   if applied {
      cmd.env("ATHAS_SHELL_INTEGRATION", "1");
   }

   applied
}

fn executable_name(path: &str) -> Option<&str> {
   path
      .rsplit(['/', '\\'])
      .next()
      .filter(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::ffi::OsStr;

   fn install_dir() -> PathBuf {
      let base = std::env::temp_dir().join(format!(
         "athas-shell-integration-test-{}",
         std::process::id()
      ));
      ensure_shell_integration_dir(&base).unwrap()
   }

   fn argv(cmd: &CommandBuilder) -> Vec<String> {
      cmd.get_argv()
         .iter()
         .map(|value| value.to_string_lossy().into_owned())
         .collect()
   }

   #[test]
   fn installs_every_script_once_and_refreshes_changed_copies() {
      let dir = install_dir();
      let zshrc = dir.join("zsh").join(".zshrc");
      assert!(zshrc.is_file());
      assert!(
         dir.join("bash")
            .join("athas-shell-integration.bash")
            .is_file()
      );
      assert!(
         dir.join("fish")
            .join("fish")
            .join("vendor_conf.d")
            .join("athas-shell-integration.fish")
            .is_file()
      );

      fs::write(&zshrc, "stale").unwrap();
      let refreshed = ensure_shell_integration_dir(dir.parent().unwrap()).unwrap();
      assert_eq!(refreshed, dir);
      assert!(
         fs::read_to_string(&zshrc)
            .unwrap()
            .contains("athas-shell-integration.zsh")
      );
   }

   #[cfg(not(target_os = "windows"))]
   #[test]
   fn zsh_redirects_zdotdir_and_remembers_the_user_directory() {
      let dir = install_dir();
      let mut cmd = CommandBuilder::new("/bin/zsh");
      let environment =
         HashMap::from([("ZDOTDIR".to_string(), "/home/me/.config/zsh".to_string())]);

      assert!(apply_shell_integration(
         &mut cmd,
         &dir,
         Some("/bin/zsh"),
         &environment
      ));
      assert_eq!(cmd.get_env("ZDOTDIR"), Some(dir.join("zsh").as_os_str()));
      assert_eq!(
         cmd.get_env("ATHAS_USER_ZDOTDIR"),
         Some(OsStr::new("/home/me/.config/zsh"))
      );
      assert_eq!(
         cmd.get_env("ATHAS_SHELL_INTEGRATION"),
         Some(OsStr::new("1"))
      );
   }

   #[cfg(not(target_os = "windows"))]
   #[test]
   fn bash_loads_the_integration_through_an_init_file() {
      let dir = install_dir();
      let mut cmd = CommandBuilder::new("/bin/bash");

      assert!(apply_shell_integration(
         &mut cmd,
         &dir,
         Some("/bin/bash"),
         &HashMap::new()
      ));
      assert_eq!(
         argv(&cmd),
         vec![
            "/bin/bash".to_string(),
            "--init-file".to_string(),
            dir.join("bash")
               .join("athas-shell-integration.bash")
               .to_string_lossy()
               .into_owned(),
         ]
      );
   }

   #[cfg(not(target_os = "windows"))]
   #[test]
   fn fish_prepends_the_vendor_data_directory() {
      let dir = install_dir();
      let mut cmd = CommandBuilder::new("/opt/homebrew/bin/fish");
      let environment = HashMap::from([("XDG_DATA_DIRS".to_string(), "/custom/share".to_string())]);

      assert!(apply_shell_integration(
         &mut cmd,
         &dir,
         Some("/opt/homebrew/bin/fish"),
         &environment
      ));
      assert_eq!(
         cmd.get_env("XDG_DATA_DIRS"),
         Some(OsStr::new(&format!(
            "{}:/custom/share",
            dir.join("fish").display()
         )))
      );
   }

   #[test]
   fn git_bash_loads_the_integration_through_an_init_file() {
      let dir = install_dir();
      let mut cmd = CommandBuilder::new("bash.exe");

      assert!(apply_shell_integration(
         &mut cmd,
         &dir,
         Some(r"C:\Program Files\Git\bin\bash.exe"),
         &HashMap::new()
      ));
      assert_eq!(
         argv(&cmd),
         vec![
            "bash.exe".to_string(),
            "--init-file".to_string(),
            dir.join("bash")
               .join("athas-shell-integration.bash")
               .to_string_lossy()
               .into_owned(),
         ]
      );
      assert_eq!(
         cmd.get_env("ATHAS_SHELL_LOGIN").is_some(),
         cfg!(target_os = "windows")
      );
   }

   #[test]
   fn powershell_dot_sources_the_integration_after_the_profile() {
      let dir = install_dir();
      let mut cmd = CommandBuilder::new("pwsh");

      assert!(apply_shell_integration(
         &mut cmd,
         &dir,
         Some("/usr/local/bin/pwsh"),
         &HashMap::new()
      ));
      assert_eq!(
         argv(&cmd),
         vec![
            "pwsh".to_string(),
            "-NoExit".to_string(),
            "-Command".to_string(),
            format!(
               ". '{}'",
               dir.join("powershell")
                  .join("athas-shell-integration.ps1")
                  .display()
            ),
         ]
      );
      assert_eq!(
         cmd.get_env("ATHAS_SHELL_INTEGRATION"),
         Some(OsStr::new("1"))
      );
   }

   #[cfg(not(target_os = "windows"))]
   #[test]
   fn unknown_shells_and_missing_scripts_leave_the_command_alone() {
      let dir = install_dir();
      let mut cmd = CommandBuilder::new("/usr/bin/nu");
      assert!(!apply_shell_integration(
         &mut cmd,
         &dir,
         Some("/usr/bin/nu"),
         &HashMap::new()
      ));
      assert!(cmd.get_env("ATHAS_SHELL_INTEGRATION").is_none());

      let mut cmd = CommandBuilder::new("/bin/zsh");
      let missing = dir.join("missing");
      assert!(!apply_shell_integration(
         &mut cmd,
         &missing,
         Some("/bin/zsh"),
         &HashMap::new()
      ));
      assert!(cmd.get_env("ZDOTDIR").is_none());
   }
}
