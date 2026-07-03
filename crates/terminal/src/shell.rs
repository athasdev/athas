use serde::{Deserialize, Serialize};
use std::{
   env,
   path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shell {
   pub id: String,
   pub name: String,
   pub exec_win: Option<String>,
   pub exec_unix: Option<String>,
   pub kind: Option<String>,
   pub wsl_distribution: Option<String>,
}

// Helper function to find appropriate executable for specific os
fn shell_exe_in_path(exe: &str) -> Option<String> {
   let path_match = env::var("PATH")
      .ok()
      .and_then(|paths| path_from_list(exe, env::split_paths(&paths)));
   let known_match = windows_known_shell_path(exe);

   resolve_shell_executable(exe, path_match, known_match)
}

fn resolve_shell_executable(
   exe: &str,
   path_match: Option<String>,
   known_match: Option<String>,
) -> Option<String> {
   if cfg!(target_os = "windows") && exe.eq_ignore_ascii_case("bash.exe") {
      return known_match.or(path_match);
   }

   path_match.or(known_match)
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
fn windows_known_shell_candidates(exe: &str) -> Vec<PathBuf> {
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

   if exe.eq_ignore_ascii_case("bash.exe") {
      for key in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
         if let Ok(base_dir) = env::var(key) {
            push_git_bash_candidates(&mut candidates, Path::new(&base_dir).join("Git"), exe);
         }
      }

      if let Ok(base_dir) = env::var("LOCALAPPDATA") {
         push_git_bash_candidates(
            &mut candidates,
            Path::new(&base_dir).join("Programs").join("Git"),
            exe,
         );
      }

      for key in ["SCOOP", "SCOOP_GLOBAL"] {
         if let Ok(base_dir) = env::var(key) {
            push_git_bash_candidates(
               &mut candidates,
               Path::new(&base_dir)
                  .join("apps")
                  .join("git")
                  .join("current"),
               exe,
            );
         }
      }

      if let Ok(user_profile) = env::var("USERPROFILE") {
         push_git_bash_candidates(
            &mut candidates,
            Path::new(&user_profile)
               .join("scoop")
               .join("apps")
               .join("git")
               .join("current"),
            exe,
         );
      }
   }

   candidates
}

#[cfg(target_os = "windows")]
fn push_git_bash_candidates(candidates: &mut Vec<PathBuf>, git_root: PathBuf, exe: &str) {
   candidates.push(git_root.join("bin").join(exe));
   candidates.push(git_root.join("usr").join("bin").join(exe));
}

fn path_from_list<I>(exe: &str, paths: I) -> Option<String>
where
   I: IntoIterator<Item = PathBuf>,
{
   paths.into_iter().find_map(|p| {
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
   let path_match = path_from_list(exe, paths.iter().cloned());
   let known_match = windows_known_shell_path(exe);

   resolve_shell_executable(exe, path_match, known_match)
}

impl Shell {
   // Returns a list of shells and paths for each shell and respective OS exe type
   pub fn get_shell_list() -> Vec<Shell> {
      if cfg!(windows) {
         let wsl_executable = shell_exe_in_path("wsl.exe");
         let mut shells = vec![
            Shell {
               id: "cmd".into(),
               name: "Command Prompt".into(),
               exec_win: shell_exe_in_path("cmd.exe"),
               exec_unix: None,
               kind: Some("windows".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "powershell".into(),
               name: "Windows PowerShell".into(),
               exec_win: shell_exe_in_path("powershell.exe"),
               exec_unix: None,
               kind: Some("windows".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "pwsh".into(),
               name: "PowerShell Core".into(),
               exec_win: shell_exe_in_path("pwsh.exe"),
               exec_unix: None,
               kind: Some("windows".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "nu".into(),
               name: "Nushell".into(),
               exec_win: shell_exe_in_path("nu.exe"),
               exec_unix: None,
               kind: Some("windows".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "wsl".into(),
               name: "WSL Default".into(),
               exec_win: wsl_executable.clone(),
               exec_unix: None,
               kind: Some("wsl".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "bash".into(),
               name: "Git Bash".into(),
               exec_win: shell_exe_in_path("bash.exe"),
               exec_unix: None,
               kind: Some("windows".into()),
               wsl_distribution: None,
            },
         ];

         if wsl_executable.is_some()
            && let Ok(distributions) = athas_wsl::list_distributions()
         {
            shells.extend(distributions.into_iter().map(|distribution| Shell {
               id: athas_wsl::wsl_shell_id(&distribution.name),
               name: format!("WSL: {}", distribution.name),
               exec_win: wsl_executable.clone(),
               exec_unix: None,
               kind: Some("wsl".into()),
               wsl_distribution: Some(distribution.name),
            }));
         }

         shells
      } else {
         vec![
            Shell {
               id: "bash".into(),
               name: "Bash".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("bash"),
               kind: Some("unix".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "nu".into(),
               name: "Nushell".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("nu"),
               kind: Some("unix".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "zsh".into(),
               name: "Zsh".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("zsh"),
               kind: Some("unix".into()),
               wsl_distribution: None,
            },
            Shell {
               id: "fish".into(),
               name: "Fish".into(),
               exec_win: None,
               exec_unix: shell_exe_in_path("fish"),
               kind: Some("unix".into()),
               wsl_distribution: None,
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

   #[cfg(target_os = "windows")]
   #[test]
   fn git_bash_prefers_known_install_over_path_shims() {
      let path_match = Some(r"C:\Users\me\scoop\shims\bash.exe".to_string());
      let known_match = Some(r"C:\Users\me\scoop\apps\git\current\bin\bash.exe".to_string());

      assert_eq!(
         resolve_shell_executable("bash.exe", path_match, known_match.clone()),
         known_match
      );
   }

   #[cfg(target_os = "windows")]
   #[test]
   fn non_bash_shells_prefer_path_entries() {
      let path_match = Some(r"C:\tools\pwsh.exe".to_string());
      let known_match = Some(r"C:\Program Files\PowerShell\7\pwsh.exe".to_string());

      assert_eq!(
         resolve_shell_executable("pwsh.exe", path_match.clone(), known_match),
         path_match
      );
   }

   #[cfg(not(target_os = "windows"))]
   #[test]
   fn shell_exe_in_path_for_test_returns_none_when_not_found() {
      assert!(shell_exe_in_path_for_test("definitely-missing-shell.exe", &[]).is_none());
   }
}
