use super::{copy_dir_all, remove_dir_all};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::{AppHandle, Emitter, State, command};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardOperation {
   Copy,
   Cut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardEntry {
   pub path: String,
   pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileClipboardState {
   pub entries: Vec<ClipboardEntry>,
   pub operation: ClipboardOperation,
}

pub type FileClipboard = RwLock<Option<FileClipboardState>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PastedEntry {
   pub source_path: String,
   pub destination_path: String,
   pub is_dir: bool,
}

fn generate_unique_path(base: &Path) -> std::path::PathBuf {
   if !base.exists() {
      return base.to_path_buf();
   }

   let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
   let ext = base.extension().and_then(|e| e.to_str());
   let parent = base.parent().unwrap_or(base);

   // First try _copy
   let candidate = if let Some(ext) = ext {
      parent.join(format!("{}_copy.{}", stem, ext))
   } else {
      parent.join(format!("{}_copy", stem))
   };
   if !candidate.exists() {
      return candidate;
   }

   // Then try _copy_2, _copy_3, ...
   let mut counter = 2u32;
   loop {
      let candidate = if let Some(ext) = ext {
         parent.join(format!("{}_copy_{}.{}", stem, counter, ext))
      } else {
         parent.join(format!("{}_copy_{}", stem, counter))
      };
      if !candidate.exists() {
         return candidate;
      }
      counter += 1;
   }
}

#[command]
pub async fn clipboard_set(
   state: State<'_, FileClipboard>,
   app: AppHandle,
   entries: Vec<ClipboardEntry>,
   operation: ClipboardOperation,
) -> Result<(), String> {
   let new_state = FileClipboardState { entries, operation };
   {
      let mut clipboard = state.write().await;
      *clipboard = Some(new_state.clone());
   }
   app.emit("file-clipboard-changed", &new_state)
      .map_err(|e| e.to_string())?;
   Ok(())
}

#[command]
pub async fn clipboard_get(
   state: State<'_, FileClipboard>,
) -> Result<Option<FileClipboardState>, String> {
   let clipboard = state.read().await;
   Ok(clipboard.clone())
}

#[command]
pub async fn clipboard_clear(
   state: State<'_, FileClipboard>,
   app: AppHandle,
) -> Result<(), String> {
   {
      let mut clipboard = state.write().await;
      *clipboard = None;
   }
   app.emit("file-clipboard-cleared", ())
      .map_err(|e| e.to_string())?;
   Ok(())
}

#[command]
pub async fn clipboard_paste(
   state: State<'_, FileClipboard>,
   app: AppHandle,
   target_directory: String,
) -> Result<Vec<PastedEntry>, String> {
   let clipboard_state = {
      let clipboard = state.read().await;
      clipboard.clone()
   };

   let clipboard_state = clipboard_state.ok_or("Clipboard is empty")?;
   let target_dir = Path::new(&target_directory);

   if !target_dir.is_dir() {
      return Err("Target is not a directory".to_string());
   }

   let mut pasted: Vec<PastedEntry> = Vec::new();

   for entry in &clipboard_state.entries {
      let source = Path::new(&entry.path);
      if !source.exists() {
         return Err(format!("Source path does not exist: {}", entry.path));
      }

      let file_name = source
         .file_name()
         .ok_or("Invalid source file name")?
         .to_string_lossy()
         .to_string();
      let raw_dest = target_dir.join(&file_name);

      match clipboard_state.operation {
         ClipboardOperation::Copy => {
            let dest = generate_unique_path(&raw_dest);
            if entry.is_dir {
               copy_dir_all(source, &dest)?;
            } else {
               fs::copy(source, &dest).map_err(|e| format!("Failed to copy file: {}", e))?;
            }
            pasted.push(PastedEntry {
               source_path: entry.path.clone(),
               destination_path: dest.to_string_lossy().to_string(),
               is_dir: entry.is_dir,
            });
         }
         ClipboardOperation::Cut => {
            // Prevent moving directory into itself
            if entry.is_dir && target_dir.starts_with(source) {
               return Err("Cannot move a directory into itself".to_string());
            }

            let dest = generate_unique_path(&raw_dest);

            // Try rename first (fast for same filesystem)
            match fs::rename(source, &dest) {
               Ok(()) => {}
               Err(_) => {
                  // Fallback: copy + delete
                  if entry.is_dir {
                     copy_dir_all(source, &dest)?;
                     remove_dir_all(source)?;
                  } else {
                     fs::copy(source, &dest).map_err(|e| format!("Failed to copy file: {}", e))?;
                     fs::remove_file(source)
                        .map_err(|e| format!("Failed to remove source: {}", e))?;
                  }
               }
            }

            pasted.push(PastedEntry {
               source_path: entry.path.clone(),
               destination_path: dest.to_string_lossy().to_string(),
               is_dir: entry.is_dir,
            });
         }
      }
   }

   // After cut-paste, convert clipboard to Copy mode with new destination paths
   if clipboard_state.operation == ClipboardOperation::Cut {
      let new_entries: Vec<ClipboardEntry> = pasted
         .iter()
         .map(|p| ClipboardEntry {
            path: p.destination_path.clone(),
            is_dir: p.is_dir,
         })
         .collect();
      let new_state = FileClipboardState {
         entries: new_entries,
         operation: ClipboardOperation::Copy,
      };
      {
         let mut clipboard = state.write().await;
         *clipboard = Some(new_state.clone());
      }
      app.emit("file-clipboard-changed", &new_state)
         .map_err(|e| e.to_string())?;
   }

   Ok(pasted)
}
