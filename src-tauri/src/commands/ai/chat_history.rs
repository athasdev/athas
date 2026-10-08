use athas_ai::{
   ChatData, ChatHistoryRepository, ChatSaveScope, ChatStats, ChatWithMessages, MessageData,
   ToolCallData,
};
use std::path::PathBuf;
use tauri::{Manager, command};

fn chat_history_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
   let app_data_dir = app
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to get app data dir: {}", e))?;
   Ok(app_data_dir.join("chat_history.db"))
}

fn repository(app: &tauri::AppHandle) -> Result<ChatHistoryRepository, String> {
   Ok(ChatHistoryRepository::new(chat_history_db_path(app)?))
}

#[command]
#[specta::specta]
pub async fn init_chat_database(app: tauri::AppHandle) -> Result<(), String> {
   repository(&app)?.initialize()
}

#[command]
#[specta::specta]
pub async fn save_chat(
   app: tauri::AppHandle,
   chat: ChatData,
   messages: Vec<MessageData>,
   tool_calls: Vec<ToolCallData>,
   scope: ChatSaveScope,
) -> Result<(), String> {
   let repository = repository(&app)?;
   match scope {
      ChatSaveScope::AllMessages => repository.save_chat(chat, messages, tool_calls),
      ChatSaveScope::ChangedMessages => repository.save_chat_messages(chat, messages, tool_calls),
   }
}

#[command]
#[specta::specta]
pub async fn update_chat_metadata(app: tauri::AppHandle, chat: ChatData) -> Result<(), String> {
   repository(&app)?.update_chat_metadata(chat)
}

#[command]
#[specta::specta]
pub async fn load_all_chats(app: tauri::AppHandle) -> Result<Vec<ChatData>, String> {
   repository(&app)?.load_all_chats()
}

#[command]
#[specta::specta]
pub async fn load_chat(app: tauri::AppHandle, chat_id: String) -> Result<ChatWithMessages, String> {
   repository(&app)?.load_chat(&chat_id)
}

#[command]
#[specta::specta]
pub async fn delete_chat(app: tauri::AppHandle, chat_id: String) -> Result<(), String> {
   repository(&app)?.delete_chat(&chat_id)
}

#[command]
#[specta::specta]
pub async fn save_chat_checkpoints(
   app: tauri::AppHandle,
   chat_id: String,
   data: Option<String>,
   updated_at: i64,
) -> Result<(), String> {
   repository(&app)?.save_checkpoints(&chat_id, data, updated_at)
}

#[command]
#[specta::specta]
pub async fn load_chat_checkpoints(
   app: tauri::AppHandle,
   chat_id: String,
) -> Result<Option<String>, String> {
   repository(&app)?.load_checkpoints(&chat_id)
}

#[command]
#[specta::specta]
pub async fn search_chats(app: tauri::AppHandle, query: String) -> Result<Vec<ChatData>, String> {
   repository(&app)?.search_chats(&query)
}

#[command]
#[specta::specta]
pub async fn get_chat_stats(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
   let stats: ChatStats = repository(&app)?.get_stats()?;
   Ok(serde_json::json!({
      "total_chats": stats.total_chats,
      "total_messages": stats.total_messages,
      "total_tool_calls": stats.total_tool_calls,
   }))
}
