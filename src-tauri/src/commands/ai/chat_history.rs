use athas_ai::{
   ChatData, ChatHistoryRepository, ChatStats, ChatWithMessages, MessageData, ToolCallData,
};
use std::path::PathBuf;
use tauri::{Manager, command};

fn chat_history_db_path(app: &crate::app_runtime::AppHandle) -> Result<PathBuf, String> {
   let app_data_dir = app
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to get app data dir: {}", e))?;
   Ok(app_data_dir.join("chat_history.db"))
}

fn repository(app: &crate::app_runtime::AppHandle) -> Result<ChatHistoryRepository, String> {
   Ok(ChatHistoryRepository::new(chat_history_db_path(app)?))
}

#[command]
pub async fn init_chat_database(app: crate::app_runtime::AppHandle) -> Result<(), String> {
   repository(&app)?.initialize()
}

#[command]
pub async fn save_chat(
   app: crate::app_runtime::AppHandle,
   chat: ChatData,
   messages: Vec<MessageData>,
   tool_calls: Vec<ToolCallData>,
) -> Result<(), String> {
   repository(&app)?.save_chat(chat, messages, tool_calls)
}

#[command]
pub async fn load_all_chats(app: crate::app_runtime::AppHandle) -> Result<Vec<ChatData>, String> {
   repository(&app)?.load_all_chats()
}

#[command]
pub async fn load_chat(
   app: crate::app_runtime::AppHandle,
   chat_id: String,
) -> Result<ChatWithMessages, String> {
   repository(&app)?.load_chat(&chat_id)
}

#[command]
pub async fn delete_chat(
   app: crate::app_runtime::AppHandle,
   chat_id: String,
) -> Result<(), String> {
   repository(&app)?.delete_chat(&chat_id)
}

#[command]
pub async fn search_chats(
   app: crate::app_runtime::AppHandle,
   query: String,
) -> Result<Vec<ChatData>, String> {
   repository(&app)?.search_chats(&query)
}

#[command]
pub async fn get_chat_stats(
   app: crate::app_runtime::AppHandle,
) -> Result<serde_json::Value, String> {
   let stats: ChatStats = repository(&app)?.get_stats()?;
   Ok(serde_json::json!({
      "total_chats": stats.total_chats,
      "total_messages": stats.total_messages,
      "total_tool_calls": stats.total_tool_calls,
   }))
}
