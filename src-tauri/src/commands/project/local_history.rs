use super::path_guard::require_path_under_home;
use crate::app_runtime::AppHandle;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
   fs,
   path::{Path, PathBuf},
};
use tauri::{Manager, command};

const MAX_ENTRIES_PER_FILE: usize = 50;
const AUTO_SAVE_MIN_INTERVAL_MS: i64 = 30_000;

#[derive(Clone, Deserialize, Serialize)]
pub struct LocalHistoryEntry {
   id: String,
   file_path: String,
   file_name: String,
   created_at: i64,
   size: u64,
   content_hash: String,
   reason: String,
   label: Option<String>,
}

fn sha256_hex(bytes: &[u8]) -> String {
   let mut hasher = Sha256::new();
   hasher.update(bytes);
   format!("{:x}", hasher.finalize())
}

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
   let app_data_dir = app
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to get app data dir: {}", e))?;
   Ok(app_data_dir.join("local_history"))
}

fn canonical_file_path(path: &str) -> Result<PathBuf, String> {
   let file_path = require_path_under_home(path)?;
   if !file_path.is_file() {
      return Err("Local history is only available for files".to_string());
   }
   Ok(file_path)
}

fn file_history_dir(app: &AppHandle, file_path: &Path) -> Result<PathBuf, String> {
   let file_key = sha256_hex(file_path.to_string_lossy().as_bytes());
   Ok(history_root(app)?.join(file_key))
}

fn metadata_path(history_dir: &Path) -> PathBuf {
   history_dir.join("entries.json")
}

fn snapshot_path(history_dir: &Path, entry_id: &str) -> PathBuf {
   history_dir.join("snapshots").join(entry_id)
}

fn read_entries(history_dir: &Path) -> Result<Vec<LocalHistoryEntry>, String> {
   let path = metadata_path(history_dir);
   if !path.exists() {
      return Ok(Vec::new());
   }

   let content =
      fs::read_to_string(path).map_err(|e| format!("Failed to read local history: {}", e))?;
   serde_json::from_str(&content).map_err(|e| format!("Failed to parse local history: {}", e))
}

fn write_entries(history_dir: &Path, entries: &[LocalHistoryEntry]) -> Result<(), String> {
   fs::create_dir_all(history_dir)
      .map_err(|e| format!("Failed to create local history directory: {}", e))?;
   let content = serde_json::to_string_pretty(entries)
      .map_err(|e| format!("Failed to serialize local history: {}", e))?;
   fs::write(metadata_path(history_dir), content)
      .map_err(|e| format!("Failed to write local history: {}", e))
}

fn prune_entries(history_dir: &Path, entries: &mut Vec<LocalHistoryEntry>) {
   if entries.len() <= MAX_ENTRIES_PER_FILE {
      return;
   }

   let removed = entries.split_off(MAX_ENTRIES_PER_FILE);
   for entry in removed {
      let _ = fs::remove_file(snapshot_path(history_dir, &entry.id));
   }
}

#[command]
pub fn local_history_record_file(
   app: AppHandle,
   path: String,
   reason: Option<String>,
   label: Option<String>,
) -> Result<Option<LocalHistoryEntry>, String> {
   let file_path = canonical_file_path(&path)?;
   let content = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
   let content_hash = sha256_hex(&content);
   let history_dir = file_history_dir(&app, &file_path)?;
   let mut entries = read_entries(&history_dir)?;
   let now = Utc::now().timestamp_millis();
   let reason = reason.unwrap_or_else(|| "save".to_string());

   if let Some(latest) = entries.first() {
      if latest.content_hash == content_hash {
         return Ok(None);
      }

      if reason == "auto-save" && now - latest.created_at < AUTO_SAVE_MIN_INTERVAL_MS {
         return Ok(None);
      }
   }

   fs::create_dir_all(history_dir.join("snapshots"))
      .map_err(|e| format!("Failed to create local history snapshots: {}", e))?;

   let id = format!(
      "{}-{}",
      now,
      content_hash.chars().take(12).collect::<String>()
   );
   fs::write(snapshot_path(&history_dir, &id), &content)
      .map_err(|e| format!("Failed to write local history snapshot: {}", e))?;

   let entry = LocalHistoryEntry {
      id,
      file_path: file_path.to_string_lossy().to_string(),
      file_name: file_path
         .file_name()
         .map(|name| name.to_string_lossy().to_string())
         .unwrap_or_else(|| "Untitled".to_string()),
      created_at: now,
      size: content.len() as u64,
      content_hash,
      reason,
      label: label.filter(|value| !value.trim().is_empty()),
   };

   entries.insert(0, entry.clone());
   prune_entries(&history_dir, &mut entries);
   write_entries(&history_dir, &entries)?;

   Ok(Some(entry))
}

#[command]
pub fn local_history_rename_entry(
   app: AppHandle,
   path: String,
   entry_id: String,
   label: Option<String>,
) -> Result<LocalHistoryEntry, String> {
   let file_path = canonical_file_path(&path)?;
   let history_dir = file_history_dir(&app, &file_path)?;
   let mut entries = read_entries(&history_dir)?;
   let entry = entries
      .iter_mut()
      .find(|entry| entry.id == entry_id)
      .ok_or_else(|| "Local history entry not found".to_string())?;

   entry.label = label.filter(|value| !value.trim().is_empty());
   let updated = entry.clone();
   write_entries(&history_dir, &entries)?;
   Ok(updated)
}

#[command]
pub fn local_history_list_file(
   app: AppHandle,
   path: String,
) -> Result<Vec<LocalHistoryEntry>, String> {
   let file_path = canonical_file_path(&path)?;
   let history_dir = file_history_dir(&app, &file_path)?;
   read_entries(&history_dir)
}

#[command]
pub fn local_history_read_entry(
   app: AppHandle,
   path: String,
   entry_id: String,
) -> Result<String, String> {
   let file_path = canonical_file_path(&path)?;
   let history_dir = file_history_dir(&app, &file_path)?;
   let entries = read_entries(&history_dir)?;

   if !entries.iter().any(|entry| entry.id == entry_id) {
      return Err("Local history entry not found".to_string());
   }

   fs::read_to_string(snapshot_path(&history_dir, &entry_id))
      .map_err(|e| format!("Failed to read local history snapshot: {}", e))
}

#[command]
pub fn local_history_delete_entry(
   app: AppHandle,
   path: String,
   entry_id: String,
) -> Result<(), String> {
   let file_path = canonical_file_path(&path)?;
   let history_dir = file_history_dir(&app, &file_path)?;
   let mut entries = read_entries(&history_dir)?;
   let original_len = entries.len();
   entries.retain(|entry| entry.id != entry_id);

   if entries.len() == original_len {
      return Err("Local history entry not found".to_string());
   }

   let _ = fs::remove_file(snapshot_path(&history_dir, &entry_id));
   write_entries(&history_dir, &entries)
}
