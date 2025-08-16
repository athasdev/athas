// Shell functionality - currently half-implemented
// This module exists to maintain the module structure but contains no active code
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shell {
   pub id: String,
   pub name: String,
   pub exec_win: Option<String>,
   pub exec_unix: Option<String>,
}

impl Shell {
   // returns a list of shells and paths for each shell and respective OS exe type
   pub fn get_shell_list() -> Vec<Shell> {
      if cfg!(windows) {
         vec![
            Shell {
               id: "cmd".into(),
               name: "Command Prompt".into(),
               exec_win: Some(r"cmd.exe".into()),
               exec_unix: None,
            },
            Shell {
               id: "powershell".into(),
               name: "Windows PowerShell".into(),
               exec_win: Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".into()),
               exec_unix: None,
            },
            Shell {
               id: "pwsh".into(),
               name: "PowerShell Core".into(),
               exec_win: Some("pwsh.exe".into()),
               exec_unix: None,
            },
            Shell {
               id: "nu".into(),
               name: "Nushell".into(),
               // need to find a way to not hardcode the path
               exec_win: Some(r"C:\Users\emcho\AppData\Local\Programs\nu\bin\nu.exe".into()),
               exec_unix: None,
            },
            Shell {
               id: "wsl".into(),
               name: "Windows Subsystem for Linux".into(),
               exec_win: Some("wsl.exe".into()),
               exec_unix: None,
            },
            Shell {
               id: "bash".into(),
               name: "Git Bash".into(),
               exec_win: Some(r"C:\Program Files\Git\bin\bash.exe".into()),
               exec_unix: None,
            },
         ]
      } else {
         vec![
            Shell {
               id: "bash".into(),
               name: "Bash".into(),
               exec_win: None,
               exec_unix: Some("bin/bash".into()),
            },
            Shell {
               id: "zsh".into(),
               name: "Zsh".into(),
               exec_win: None,
               exec_unix: Some("bin/zsh".into()),
            },
            Shell {
               id: "fish".into(),
               name: "Fish".into(),
               exec_win: None,
               exec_unix: Some("bin/fish".into()),
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
