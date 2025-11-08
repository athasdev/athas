// Shell functionality - currently half-implemented
// This module exists to maintain the module structure but contains no active code
use serde::{Deserialize, Serialize};
use std::{env, path::Path};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shell {
   pub id: String,
   pub name: String,
   pub exec_win: Option<String>,
   pub exec_unix: Option<String>,
}

// helper function to find appropriate executable for specific os
// needs improvement
fn shell_exe_in_path(exe: &str) -> Option<String> {
   env::var("PATH").ok().and_then(|paths| {
      env::split_paths(&paths).find_map(|p| {
         let full_path = p.join(exe);
         if full_path.exists() {
            Some(full_path.to_string_lossy().into_owned())
         } else {
            None
         }
      })
   })
}

impl Shell {
   // returns a list of shells and paths for each shell and respective OS exe type
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

// helper command to get available shells in PATH
#[command]
pub fn get_shells() -> Vec<Shell> {
   Shell::get_available_shells()
}

// need to find a way to make it open in a new tab
// #[command]
// pub fn execute_shell(shell_id: &str) -> Result<String, String> {
//    let shell_list = Shell::get_available_shells();

//    let shell = shell_list
//       .into_iter()
//       .find(|s| s.id == shell_id)
//       .ok_or_else(|| format!("Shell {shell_id} not found in PATH"))?;

//    let exe = if cfg!(windows) {
//       shell
//          .exec_win
//          .ok_or("No Windows executable for the shell")?
//    } else {
//       shell.exec_unix.ok_or("No Unix executable for the shell")?
//    };

//    Command::new(exe)
//       .output()
//       .map_err(|e| format!("Failed to execute shell: {}", e))?;

//    Ok(format!("Shell {} started", shell.name))
// }
