use rusqlite::{Connection, Result as SqliteResult, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Manager, command};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatData {
   pub id: String,
   pub title: String,
   pub created_at: i64,
   pub last_message_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageData {
   pub id: String,
   pub chat_id: String,
   pub role: String,
   pub content: String,
   pub timestamp: i64,
   pub is_streaming: bool,
   pub is_tool_use: bool,
   pub tool_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCallData {
   pub message_id: String,
   pub name: String,
   pub input: Option<String>,
   pub output: Option<String>,
   pub error: Option<String>,
   pub timestamp: i64,
   pub is_complete: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatWithMessages {
   pub chat: ChatData,
   pub messages: Vec<MessageData>,
   pub tool_calls: Vec<ToolCallData>,
}

fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
   let app_data_dir = app
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to get app data dir: {}", e))?;

   std::fs::create_dir_all(&app_data_dir)
      .map_err(|e| format!("Failed to create app data dir: {}", e))?;

   Ok(app_data_dir.join("chat_history.db"))
}

fn open_connection(app: &tauri::AppHandle) -> Result<Connection, String> {
   let db_path = get_db_path(app)?;
   Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))
}

#[command]
pub async fn init_chat_database(app: tauri::AppHandle) -> Result<(), String> {
   let conn = open_connection(&app)?;

   conn
      .execute(
         "CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_message_at INTEGER NOT NULL
        )",
         [],
      )
      .map_err(|e| format!("Failed to create chats table: {}", e))?;

   conn
      .execute(
         "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            is_streaming BOOLEAN DEFAULT 0,
            is_tool_use BOOLEAN DEFAULT 0,
            tool_name TEXT,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )",
         [],
      )
      .map_err(|e| format!("Failed to create messages table: {}", e))?;

   conn
      .execute(
         "CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            name TEXT NOT NULL,
            input TEXT,
            output TEXT,
            error TEXT,
            timestamp INTEGER NOT NULL,
            is_complete BOOLEAN DEFAULT 0,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )",
         [],
      )
      .map_err(|e| format!("Failed to create tool_calls table: {}", e))?;

   // Create indexes for performance
   conn
      .execute(
         "CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)",
         [],
      )
      .map_err(|e| format!("Failed to create messages index: {}", e))?;

   conn
      .execute(
         "CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_at DESC)",
         [],
      )
      .map_err(|e| format!("Failed to create chats index: {}", e))?;

   conn
      .execute(
         "CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id)",
         [],
      )
      .map_err(|e| format!("Failed to create tool_calls index: {}", e))?;

   Ok(())
}

#[command]
pub async fn save_chat(
   app: tauri::AppHandle,
   chat: ChatData,
   messages: Vec<MessageData>,
   tool_calls: Vec<ToolCallData>,
) -> Result<(), String> {
   let conn = open_connection(&app)?;

   // Start transaction
   conn
      .execute("BEGIN TRANSACTION", [])
      .map_err(|e| format!("Failed to begin transaction: {}", e))?;

   // Insert or replace chat
   match conn.execute(
      "INSERT OR REPLACE INTO chats (id, title, created_at, last_message_at) VALUES (?1, ?2, ?3, \
       ?4)",
      params![chat.id, chat.title, chat.created_at, chat.last_message_at],
   ) {
      Ok(_) => {}
      Err(e) => {
         conn.execute("ROLLBACK", []).ok();
         return Err(format!("Failed to save chat: {}", e));
      }
   }

   // Delete existing messages for this chat
   match conn.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat.id]) {
      Ok(_) => {}
      Err(e) => {
         conn.execute("ROLLBACK", []).ok();
         return Err(format!("Failed to delete old messages: {}", e));
      }
   }

   // Insert messages
   for message in messages {
      match conn.execute(
         "INSERT INTO messages (id, chat_id, role, content, timestamp, is_streaming, is_tool_use, \
          tool_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
         params![
            message.id,
            message.chat_id,
            message.role,
            message.content,
            message.timestamp,
            message.is_streaming,
            message.is_tool_use,
            message.tool_name
         ],
      ) {
         Ok(_) => {}
         Err(e) => {
            conn.execute("ROLLBACK", []).ok();
            return Err(format!("Failed to save message: {}", e));
         }
      }
   }

   // Insert tool calls
   for tool_call in tool_calls {
      match conn.execute(
         "INSERT INTO tool_calls (message_id, name, input, output, error, timestamp, is_complete)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
         params![
            tool_call.message_id,
            tool_call.name,
            tool_call.input,
            tool_call.output,
            tool_call.error,
            tool_call.timestamp,
            tool_call.is_complete
         ],
      ) {
         Ok(_) => {}
         Err(e) => {
            conn.execute("ROLLBACK", []).ok();
            return Err(format!("Failed to save tool call: {}", e));
         }
      }
   }

   // Commit transaction
   conn
      .execute("COMMIT", [])
      .map_err(|e| format!("Failed to commit transaction: {}", e))?;

   Ok(())
}

#[command]
pub async fn load_all_chats(app: tauri::AppHandle) -> Result<Vec<ChatData>, String> {
   let conn = open_connection(&app)?;

   let mut stmt = conn
      .prepare(
         "SELECT id, title, created_at, last_message_at FROM chats ORDER BY last_message_at DESC",
      )
      .map_err(|e| format!("Failed to prepare query: {}", e))?;

   let chats = stmt
      .query_map([], |row| {
         Ok(ChatData {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            last_message_at: row.get(3)?,
         })
      })
      .map_err(|e| format!("Failed to query chats: {}", e))?
      .collect::<SqliteResult<Vec<_>>>()
      .map_err(|e| format!("Failed to collect chats: {}", e))?;

   Ok(chats)
}

#[command]
pub async fn load_chat(app: tauri::AppHandle, chat_id: String) -> Result<ChatWithMessages, String> {
   let conn = open_connection(&app)?;

   // Load chat
   let mut stmt = conn
      .prepare("SELECT id, title, created_at, last_message_at FROM chats WHERE id = ?1")
      .map_err(|e| format!("Failed to prepare chat query: {}", e))?;

   let chat = stmt
      .query_row([&chat_id], |row| {
         Ok(ChatData {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            last_message_at: row.get(3)?,
         })
      })
      .map_err(|e| format!("Failed to load chat: {}", e))?;

   // Load messages
   let mut stmt = conn
      .prepare(
         "SELECT id, chat_id, role, content, timestamp, is_streaming, is_tool_use, tool_name
                  FROM messages WHERE chat_id = ?1 ORDER BY timestamp ASC",
      )
      .map_err(|e| format!("Failed to prepare messages query: {}", e))?;

   let messages = stmt
      .query_map([&chat_id], |row| {
         Ok(MessageData {
            id: row.get(0)?,
            chat_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            timestamp: row.get(4)?,
            is_streaming: row.get(5)?,
            is_tool_use: row.get(6)?,
            tool_name: row.get(7)?,
         })
      })
      .map_err(|e| format!("Failed to query messages: {}", e))?
      .collect::<SqliteResult<Vec<_>>>()
      .map_err(|e| format!("Failed to collect messages: {}", e))?;

   // Load tool calls for this chat's messages
   let message_ids: Vec<String> = messages.iter().map(|m| m.id.clone()).collect();
   let mut tool_calls = Vec::new();

   if !message_ids.is_empty() {
      let placeholders = message_ids
         .iter()
         .map(|_| "?")
         .collect::<Vec<_>>()
         .join(",");
      let query = format!(
         "SELECT message_id, name, input, output, error, timestamp, is_complete
             FROM tool_calls WHERE message_id IN ({})",
         placeholders
      );

      let mut stmt = conn
         .prepare(&query)
         .map_err(|e| format!("Failed to prepare tool_calls query: {}", e))?;

      let params: Vec<&dyn rusqlite::ToSql> = message_ids
         .iter()
         .map(|id| id as &dyn rusqlite::ToSql)
         .collect();

      tool_calls = stmt
         .query_map(params.as_slice(), |row| {
            Ok(ToolCallData {
               message_id: row.get(0)?,
               name: row.get(1)?,
               input: row.get(2)?,
               output: row.get(3)?,
               error: row.get(4)?,
               timestamp: row.get(5)?,
               is_complete: row.get(6)?,
            })
         })
         .map_err(|e| format!("Failed to query tool_calls: {}", e))?
         .collect::<SqliteResult<Vec<_>>>()
         .map_err(|e| format!("Failed to collect tool_calls: {}", e))?;
   }

   Ok(ChatWithMessages {
      chat,
      messages,
      tool_calls,
   })
}

#[command]
pub async fn delete_chat(app: tauri::AppHandle, chat_id: String) -> Result<(), String> {
   let conn = open_connection(&app)?;

   conn
      .execute("DELETE FROM chats WHERE id = ?1", params![chat_id])
      .map_err(|e| format!("Failed to delete chat: {}", e))?;

   Ok(())
}

#[command]
pub async fn search_chats(app: tauri::AppHandle, query: String) -> Result<Vec<ChatData>, String> {
   let conn = open_connection(&app)?;

   let search_pattern = format!("%{}%", query);

   let mut stmt = conn
      .prepare(
         "SELECT DISTINCT c.id, c.title, c.created_at, c.last_message_at
             FROM chats c
             LEFT JOIN messages m ON c.id = m.chat_id
             WHERE c.title LIKE ?1 OR m.content LIKE ?1
             ORDER BY c.last_message_at DESC",
      )
      .map_err(|e| format!("Failed to prepare search query: {}", e))?;

   let chats = stmt
      .query_map([&search_pattern], |row| {
         Ok(ChatData {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            last_message_at: row.get(3)?,
         })
      })
      .map_err(|e| format!("Failed to query search results: {}", e))?
      .collect::<SqliteResult<Vec<_>>>()
      .map_err(|e| format!("Failed to collect search results: {}", e))?;

   Ok(chats)
}

#[command]
pub async fn get_chat_stats(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
   let conn = open_connection(&app)?;

   let total_chats: i64 = conn
      .query_row("SELECT COUNT(*) FROM chats", [], |row| row.get(0))
      .map_err(|e| format!("Failed to count chats: {}", e))?;

   let total_messages: i64 = conn
      .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
      .map_err(|e| format!("Failed to count messages: {}", e))?;

   let total_tool_calls: i64 = conn
      .query_row("SELECT COUNT(*) FROM tool_calls", [], |row| row.get(0))
      .map_err(|e| format!("Failed to count tool calls: {}", e))?;

   Ok(serde_json::json!({
       "total_chats": total_chats,
       "total_messages": total_messages,
       "total_tool_calls": total_tool_calls,
   }))
}
