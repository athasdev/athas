use crate::app_runtime::AppHandle;
use serde::Serialize;
use std::{
   fs::{self, File},
   io::{Read, Seek, SeekFrom},
   path::{Path, PathBuf},
};
use tauri::{Manager, command};

const MAX_LOG_BYTES: u64 = 1_000_000;

#[derive(Serialize)]
pub struct AthasLogFile {
   path: String,
   content: String,
   target_line: usize,
   truncated: bool,
}

#[command]
pub fn read_athas_log(app: AppHandle) -> Result<AthasLogFile, String> {
   let log_dir = app
      .path()
      .app_log_dir()
      .map_err(|error| format!("Failed to resolve app log directory: {error}"))?;
   let log_path = latest_log_file(&log_dir)
      .ok_or_else(|| format!("No Athas log file found in {}", log_dir.display()))?;
   let (content, truncated) = read_log_tail(&log_path)?;
   let target_line = find_last_error_line(&content).unwrap_or_else(|| {
      let line_count = content.lines().count();
      line_count.saturating_sub(1)
   });

   Ok(AthasLogFile {
      path: log_path.to_string_lossy().into_owned(),
      content,
      target_line,
      truncated,
   })
}

fn latest_log_file(log_dir: &Path) -> Option<PathBuf> {
   let entries = fs::read_dir(log_dir).ok()?;

   entries
      .filter_map(Result::ok)
      .filter_map(|entry| {
         let path = entry.path();
         if path.extension().and_then(|extension| extension.to_str()) != Some("log") {
            return None;
         }
         let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()?;
         Some((path, modified))
      })
      .max_by_key(|(_, modified)| *modified)
      .map(|(path, _)| path)
}

fn read_log_tail(path: &Path) -> Result<(String, bool), String> {
   let mut file = File::open(path)
      .map_err(|error| format!("Failed to open Athas log {}: {error}", path.display()))?;
   let length = file
      .metadata()
      .map_err(|error| format!("Failed to read Athas log metadata: {error}"))?
      .len();
   let start = length.saturating_sub(MAX_LOG_BYTES);
   let truncated = start > 0;

   file
      .seek(SeekFrom::Start(start))
      .map_err(|error| format!("Failed to seek Athas log: {error}"))?;

   let mut bytes = Vec::new();
   file
      .read_to_end(&mut bytes)
      .map_err(|error| format!("Failed to read Athas log: {error}"))?;

   if truncated {
      if let Some(newline_index) = bytes.iter().position(|byte| *byte == b'\n') {
         bytes.drain(..=newline_index);
      }
   }

   Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

fn find_last_error_line(content: &str) -> Option<usize> {
   let mut last_error_line = None;

   for (index, line) in content.lines().enumerate() {
      let lower = line.to_ascii_lowercase();
      if lower.contains("[error]") || lower.contains(" error") || lower.contains("failed") {
         last_error_line = Some(index);
      }
   }

   last_error_line
}
