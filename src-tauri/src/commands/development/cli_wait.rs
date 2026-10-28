//! `athas --wait`: the CLI hands its files to Athas and blocks until they are closed.
//!
//! Like VS Code's `--waitMarkerFilePath`, the waiting process creates an empty marker file and
//! passes its path along with the files. Athas deletes the marker once every file it opened is
//! closed, or when the window holding them closes or the app quits, and the CLI returns.

use super::cli_args::CliRequest;
use std::{
   collections::{HashMap, HashSet},
   path::{Path, PathBuf},
   process::{Command, Stdio},
   sync::Mutex,
   time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

const MARKER_DIR: &str = "athas-cli-wait";
const POLL_INTERVAL: Duration = Duration::from_millis(200);

/// The wait markers each window holds, released when the window closes or the app quits.
#[derive(Default)]
pub struct CliWaits(Mutex<HashMap<String, HashSet<String>>>);

impl CliWaits {
   pub fn track(&self, label: &str, requests: &[CliRequest]) {
      let markers = requests
         .iter()
         .filter_map(|request| match request {
            CliRequest::Path {
               wait_marker: Some(marker),
               ..
            } => Some(marker.clone()),
            _ => None,
         })
         .collect::<Vec<_>>();
      if markers.is_empty() {
         return;
      }
      let mut waits = self.0.lock().expect("CLI waits lock poisoned");
      waits.entry(label.to_string()).or_default().extend(markers);
   }

   fn forget(&self, marker: &str) {
      let mut waits = self.0.lock().expect("CLI waits lock poisoned");
      for markers in waits.values_mut() {
         markers.remove(marker);
      }
   }

   pub fn release_window(&self, label: &str) {
      let markers = self
         .0
         .lock()
         .expect("CLI waits lock poisoned")
         .remove(label);
      for marker in markers.into_iter().flatten() {
         delete_marker(&marker);
      }
   }

   pub fn release_all(&self) {
      let waits = std::mem::take(&mut *self.0.lock().expect("CLI waits lock poisoned"));
      for marker in waits.into_values().flatten() {
         delete_marker(&marker);
      }
   }
}

/// Only empty files in an `athas-cli-wait` directory are markers. The CLI and the app can see
/// different temporary directories, so the directory name is checked rather than its location.
fn is_marker_path(path: &Path) -> bool {
   path.is_absolute()
      && path
         .parent()
         .and_then(Path::file_name)
         .is_some_and(|name| name == MARKER_DIR)
      && path
         .file_name()
         .and_then(|name| name.to_str())
         .is_some_and(|name| name.chars().all(|c| c.is_ascii_digit() || c == '-'))
}

fn delete_marker(marker: &str) {
   let path = Path::new(marker);
   if !is_marker_path(path) {
      log::warn!("Ignoring an invalid CLI wait marker: {marker}");
      return;
   }
   if let Err(error) = std::fs::remove_file(path)
      && error.kind() != std::io::ErrorKind::NotFound
   {
      log::error!("Failed to release CLI wait marker {marker}: {error}");
   }
}

/// Called once the files a waiting CLI opened are all closed.
#[tauri::command]
#[specta::specta]
pub fn release_cli_wait(marker: String, waits: State<'_, CliWaits>) {
   waits.forget(&marker);
   delete_marker(&marker);
}

pub fn release_window_waits(app: &tauri::AppHandle, label: &str) {
   if let Some(waits) = app.try_state::<CliWaits>() {
      waits.release_window(label);
   }
}

pub fn release_all_waits(app: &tauri::AppHandle) {
   if let Some(waits) = app.try_state::<CliWaits>() {
      waits.release_all();
   }
}

/// The CLI arguments with `--wait` swapped for `--wait-marker <marker>`. Arguments after `--`
/// belong to the command and are kept as they are.
fn forwarded_args(args: &[String], marker: &Path) -> Vec<String> {
   let mut forwarded = vec![
      "--wait-marker".to_string(),
      marker.to_string_lossy().into_owned(),
   ];
   let mut options_ended = false;
   for arg in args {
      if !options_ended && matches!(arg.as_str(), "--wait" | "-w") {
         continue;
      }
      options_ended |= arg == "--";
      forwarded.push(arg.clone());
   }
   forwarded
}

fn spawn_detached(args: &[String]) -> std::io::Result<std::process::Child> {
   let mut command = Command::new(std::env::current_exe()?);
   command
      .args(args)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null());
   // Ctrl+C in the waiting terminal must not take a freshly started Athas down with it.
   #[cfg(unix)]
   std::os::unix::process::CommandExt::process_group(&mut command, 0);
   #[cfg(windows)]
   {
      use std::os::windows::process::CommandExt;
      const DETACHED_PROCESS: u32 = 0x0000_0008;
      const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
      command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
   }
   command.spawn()
}

/// Opens the files in Athas, starting it if needed, and returns the exit code once they close.
pub fn run_waiting_cli(args: &[String]) -> i32 {
   let dir = std::env::temp_dir().join(MARKER_DIR);
   let nanos = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|elapsed| elapsed.as_nanos())
      .unwrap_or_default();
   let marker: PathBuf = dir.join(format!("{}-{nanos}", std::process::id()));
   if let Err(error) = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&marker, b"")) {
      eprintln!("athas: could not create the wait marker: {error}");
      return 1;
   }

   let mut child = match spawn_detached(&forwarded_args(args, &marker)) {
      Ok(child) => Some(child),
      Err(error) => {
         let _ = std::fs::remove_file(&marker);
         eprintln!("athas: could not start Athas: {error}");
         return 1;
      }
   };

   while marker.exists() {
      // A process that hands the files to a running Athas exits right away. One that fails
      // never opens them, so nothing would ever release the marker.
      if let Some(status) = child
         .as_mut()
         .and_then(|child| child.try_wait().ok().flatten())
      {
         child = None;
         if !status.success() {
            let _ = std::fs::remove_file(&marker);
            eprintln!("athas: Athas exited before opening the files ({status})");
            return status.code().unwrap_or(1);
         }
      }
      std::thread::sleep(POLL_INTERVAL);
   }
   0
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn forwards_everything_but_wait_before_the_end_of_options() {
      let args = ["-w", "COMMIT_EDITMSG", "--", "-w"].map(String::from);
      let marker = Path::new("/tmp/athas-cli-wait/1-2");

      assert_eq!(
         forwarded_args(&args, marker),
         [
            "--wait-marker",
            "/tmp/athas-cli-wait/1-2",
            "COMMIT_EDITMSG",
            "--",
            "-w"
         ]
         .map(String::from)
      );
   }

   #[test]
   fn accepts_only_marker_files() {
      assert!(is_marker_path(Path::new("/tmp/athas-cli-wait/123-456")));
      assert!(!is_marker_path(Path::new(
         "/tmp/athas-cli-wait/../notes.txt"
      )));
      assert!(!is_marker_path(Path::new("/tmp/other/123-456")));
      assert!(!is_marker_path(Path::new("athas-cli-wait/123-456")));
   }
}
