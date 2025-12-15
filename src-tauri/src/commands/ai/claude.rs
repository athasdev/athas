use crate::features::claude_bridge::{ClaudeCodeBridge, ClaudeStatus};
use std::sync::Arc;
use tauri::State;
use tokio::{io::AsyncWriteExt, sync::Mutex};

#[tauri::command]
pub async fn start_claude_code(
   bridge: State<'_, Arc<Mutex<ClaudeCodeBridge>>>,
   workspace_path: Option<String>,
) -> Result<ClaudeStatus, String> {
   let mut bridge = bridge.lock().await;

   // Start interceptor first
   if !bridge.get_status().interceptor_running {
      match bridge.start_interceptor().await {
         Ok(_) => {}
         Err(_) => {
            return Err(
               "Claude Code is currently unavailable. Please try again later.".to_string(),
            );
         }
      }
   }

   // Then start Claude Code with workspace path
   bridge
      .start_claude_code(workspace_path)
      .await
      .map_err(|e| e.to_string())?;

   Ok(bridge.get_status())
}

#[tauri::command]
pub async fn stop_claude_code(
   bridge: State<'_, Arc<Mutex<ClaudeCodeBridge>>>,
) -> Result<ClaudeStatus, String> {
   let mut bridge = bridge.lock().await;
   bridge
      .stop_claude_process_only()
      .await
      .map_err(|e| e.to_string())?;
   Ok(bridge.get_status())
}

#[tauri::command]
pub async fn send_claude_input(
   input: String,
   bridge: State<'_, Arc<Mutex<ClaudeCodeBridge>>>,
) -> Result<(), String> {
   let mut bridge = bridge.lock().await;

   if let Some(stdin) = &mut bridge.claude_stdin {
      // Create stream-json formatted message according to Claude Code's expected format
      let json_message = serde_json::json!({
          "type": "user",
          "message": {
              "role": "user",
              "content": [{
                  "type": "text",
                  "text": input
              }]
          }
      });

      let json_str = json_message.to_string();
      stdin
         .write_all(json_str.as_bytes())
         .await
         .map_err(|e| e.to_string())?;
      stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
      stdin.flush().await.map_err(|e| e.to_string())?;
      Ok(())
   } else {
      Err("Claude Code is not running".to_string())
   }
}

#[tauri::command]
pub async fn get_claude_status(
   bridge: State<'_, Arc<Mutex<ClaudeCodeBridge>>>,
) -> Result<ClaudeStatus, String> {
   let bridge = bridge.lock().await;
   Ok(bridge.get_status())
}
