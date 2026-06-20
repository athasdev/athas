use serde::{Deserialize, Serialize};
use std::{env, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shell {
   pub id: String,
   pub name: String,
   pub exec_win: Option<String>,
   pub exec_unix: Option<String>,
}

// Helper function to find appropriate executable for specific os
fn shell_exe_in_path(exe: &str) -> Option<String> {
   env::var("PATH")
      .ok()
      .and_then(|paths| {
         env::split_paths(&paths).find_map(|p| {
            let full_path = p.join(exe);
            if full_path.exists() {
               Some(full_path.to_string_lossy().into_owned())
            } else {
               None
            }
         })
      })
      .or_else(|| windows_known_shell_path(exe))
}

#[cfg(target_os = "windows")]
fn windows_known_shell_path(exe: &str) -> Option<String> {
   windows_known_shell_candidates(exe)
      .into_iter()
      .find(|path| path.exists())
      .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "windows"))]
fn windows_known_shell_path(_exe: &str) -> Option<String> {
   None
}

#[cfg(target_os = "windows")]
fn windows_known_shell_candidates(exe: &str) -> Vec<std::path::PathBuf> {
   let mut candidates = Vec::new();

   if matches!(exe, "cmd.exe" | "powershell.exe")
      && let Ok(windows_dir) = env::var("SystemRoot").or_else(|_| env::var("WINDIR"))
   {
      let windows_dir = Path::new(&windows_dir);
      if exe == "cmd.exe" {
         candidates.push(windows_dir.join("System32").join(exe));
      } else {
         candidates.push(
            windows_dir
               .join("System32")
               .join("WindowsPowerShell")
               .join("v1.0")
               .join(exe),
         );
         candidates.push(
            windows_dir
               .join("SysWOW64")
               .join("WindowsPowerShell")
               .join("v1.0")
               .join(exe),
         );
      }
   }

   if exe == "pwsh.exe" {
      for key in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
         if let Ok(base_dir) = env::var(key) {
            candidates.push(Path::new(&base_dir).join("PowerShell").join("7").join(exe));
         }
      }
   }

   candidates
}

#[cfg(test)]
fn path_from_list_for_test(exe: &str, paths: &[std::path::PathBuf]) -> Option<String> {
   paths.iter().find_map(|p| {
      let full_path = p.join(exe);
      if full_path.exists() {
         Some(full_path.to_string_lossy().into_owned())
      } else {
         None
      }
   })
}

#[cfg(test)]
fn shell_exe_in_path_for_test(exe: &str, paths: &[std::path::PathBuf]) -> Option<String> {
   path_from_list_for_test(exe, paths).or_else(|| windows_known_shell_path(exe))
}

impl Shell {
   // Returns a list of shells and paths for each shell and respective OS exe type
   pub fn get_shell_list() -> Vec<Shell> {
      if cfg!(windows) {
         vec![
            Shell {
               id: "cmd".into(),
               name: "Command Prompt".into(),
               exec_win: shell_exe_in_path("cmd.exe"),
               exec_unix: None,
            },
            Shell {
               id: "powershell".into(),
               name: "Windows PowerShell".into(),
               exec_win: shell_exe_in_path("powershell.exe"),
               exec_unix: None,
            },
            Shell {
               id: "pwsh".into(),
               name: "PowerShell Core".into(),
               exec_win: shell_exe_in_path("pwsh.exe"),
               exec_unix: None,
            },
            Shell {
               id: "nu".into(),
               name: "Nushell".into(),
               exec_win: shell_exe_in_path("nu.exe"),
               exec_unix: None,
            },
            Shell {
               id: "wsl".into(),
               name: "Windows Subsystem for Linux".into(),
               exec_win: shell_exe_in_path("wsl.exe"),
               exec_unix: None,
            },
            Shell {
               id: "bash".into(),
               name: "Git Bash".into(),
               exec_win: shell_exe_in_path("bash.exe"),
               exec_unix: None,
            },
         ]
      } else {
         vec![
            Shell {
               id: "bash".into(),
               name: "Bash".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("bash"),
            },
            Shell {
               id: "nu".into(),
               name: "Nushell".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("nu"),
            },
            Shell {
               id: "zsh".into(),
               name: "Zsh".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("zsh"),
            },
            Shell {
               id: "fish".into(),
               name: "Fish".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("fish"),
            },
         ]
      }
   }

   pub fn get_available_shells() -> Vec<Shell> {
      Self::get_shell_list()
         .into_iter()
         .filter(|sh| {
            let path = if cfg!(windows) {
               sh.exec_win.as_deref()
            } else {
               sh.exec_unix.as_deref()
            };
            path.map(|p| Path::new(p).exists()).unwrap_or(false)
         })
         .collect()
   }
}

pub fn get_shells() -> Vec<Shell> {
   Shell::get_available_shells()
}

pub fn get_shell_by_id(id: &str) -> Option<Shell> {
   get_shells().into_iter().find(|shell| shell.id == id)
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{
      fs,
      time::{SystemTime, UNIX_EPOCH},
   };

   #[test]
   fn shell_exe_in_path_for_test_finds_executable_in_path_entries() {
      let test_dir = std::env::temp_dir().join(format!(
         "athas-shell-test-{}",
         SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
      ));
      fs::create_dir_all(&test_dir).unwrap();
      let executable = test_dir.join("pwsh.exe");
      fs::write(&executable, "").unwrap();

      let found = shell_exe_in_path_for_test("pwsh.exe", std::slice::from_ref(&test_dir));

      assert_eq!(found, Some(executable.to_string_lossy().into_owned()));

      fs::remove_dir_all(test_dir).unwrap();
   }

   #[cfg(not(target_os = "windows"))]
   #[test]
   fn shell_exe_in_path_for_test_returns_none_when_not_found() {
      assert!(shell_exe_in_path_for_test("definitely-missing-shell.exe", &[]).is_none());
   }
}
