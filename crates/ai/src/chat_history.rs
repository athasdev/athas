use rusqlite::{Connection, Result as SqliteResult, ToSql, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatData {
   pub id: String,
   pub title: String,
   pub created_at: i64,
   pub last_message_at: i64,
   pub agent_id: Option<String>,
   pub acp_session_id: Option<String>,
   pub workspace_path: Option<String>,
   pub provider_id: Option<String>,
   pub model_id: Option<String>,
   pub branch: Option<String>,
   pub is_pinned: bool,
   pub archived_at: Option<i64>,
   /// The agent session options the user picked for this chat (mode, config options), as JSON.
   #[serde(default)]
   pub session_settings: Option<String>,
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
   #[serde(default)]
   pub images: Option<String>,
   /// The agent's latest ACP plan for this message, as JSON entries.
   #[serde(default)]
   pub plan: Option<String>,
   /// Why the agent's turn ended early (output limit, turn limit, refusal), if it did.
   #[serde(default)]
   pub stop_notice: Option<String>,
   /// The tokens the agent reported for the turn, as JSON.
   #[serde(default)]
   pub turn_usage: Option<String>,
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
   /// Presentation details (id, kind, status, locations, content offset) as JSON.
   #[serde(default)]
   pub meta: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatWithMessages {
   pub chat: ChatData,
   pub messages: Vec<MessageData>,
   pub tool_calls: Vec<ToolCallData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatStats {
   pub total_chats: i64,
   pub total_messages: i64,
   pub total_tool_calls: i64,
}

pub struct ChatHistoryRepository {
   db_path: PathBuf,
}

impl ChatHistoryRepository {
   pub fn new(db_path: PathBuf) -> Self {
      Self { db_path }
   }

   pub fn initialize(&self) -> Result<(), String> {
      let conn = self.open_connection()?;

      conn
         .execute(
            "CREATE TABLE IF NOT EXISTS chats (
               id TEXT PRIMARY KEY,
               title TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               last_message_at INTEGER NOT NULL,
               agent_id TEXT DEFAULT 'custom',
               acp_session_id TEXT,
               workspace_path TEXT,
               provider_id TEXT,
               model_id TEXT,
               branch TEXT,
               is_pinned BOOLEAN DEFAULT 0,
               archived_at INTEGER,
               session_settings TEXT
           )",
            [],
         )
         .map_err(|e| format!("Failed to create chats table: {}", e))?;

      let _ = conn.execute(
         "ALTER TABLE chats ADD COLUMN agent_id TEXT DEFAULT 'custom'",
         [],
      );
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN acp_session_id TEXT", []);
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN workspace_path TEXT", []);
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN provider_id TEXT", []);
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN model_id TEXT", []);
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN branch TEXT", []);
      let _ = conn.execute(
         "ALTER TABLE chats ADD COLUMN is_pinned BOOLEAN DEFAULT 0",
         [],
      );
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN archived_at INTEGER", []);
      let _ = conn.execute("ALTER TABLE chats ADD COLUMN session_settings TEXT", []);

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
      let _ = conn.execute("ALTER TABLE tool_calls ADD COLUMN meta TEXT", []);

      for column in ["images", "plan", "stop_notice", "turn_usage"] {
         let exists: bool = conn
            .query_row(
               "SELECT EXISTS(SELECT 1 FROM pragma_table_info('messages') WHERE name = ?1)",
               [column],
               |row| row.get(0),
            )
            .map_err(|e| format!("Failed to inspect message columns: {e}"))?;
         if !exists {
            conn
               .execute(
                  &format!("ALTER TABLE messages ADD COLUMN {column} TEXT"),
                  [],
               )
               .map_err(|e| format!("Failed to add message {column}: {e}"))?;
         }
      }

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

   pub fn save_chat(
      &self,
      chat: ChatData,
      messages: Vec<MessageData>,
      tool_calls: Vec<ToolCallData>,
   ) -> Result<(), String> {
      let conn = self.open_connection()?;

      conn
         .execute("BEGIN TRANSACTION", [])
         .map_err(|e| format!("Failed to begin transaction: {}", e))?;

      match conn.execute(
         "INSERT OR REPLACE INTO chats (id, title, created_at, last_message_at, agent_id, \
          acp_session_id, workspace_path, provider_id, model_id, branch, is_pinned, archived_at, \
          session_settings) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
         params![
            chat.id,
            chat.title,
            chat.created_at,
            chat.last_message_at,
            chat.agent_id.unwrap_or_else(|| "custom".to_string()),
            chat.acp_session_id,
            chat.workspace_path,
            chat.provider_id,
            chat.model_id,
            chat.branch,
            chat.is_pinned,
            chat.archived_at,
            chat.session_settings
         ],
      ) {
         Ok(_) => {}
         Err(e) => {
            conn.execute("ROLLBACK", []).ok();
            return Err(format!("Failed to save chat: {}", e));
         }
      }

      match conn.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat.id]) {
         Ok(_) => {}
         Err(e) => {
            conn.execute("ROLLBACK", []).ok();
            return Err(format!("Failed to delete old messages: {}", e));
         }
      }

      for message in messages {
         match conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, timestamp, is_streaming, \
             is_tool_use, tool_name, images, plan, stop_notice, turn_usage) VALUES (?1, ?2, ?3, \
             ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
               message.id,
               message.chat_id,
               message.role,
               message.content,
               message.timestamp,
               message.is_streaming,
               message.is_tool_use,
               message.tool_name,
               message.images,
               message.plan,
               message.stop_notice,
               message.turn_usage
            ],
         ) {
            Ok(_) => {}
            Err(e) => {
               conn.execute("ROLLBACK", []).ok();
               return Err(format!("Failed to save message: {}", e));
            }
         }
      }

      for tool_call in tool_calls {
         match conn.execute(
            "INSERT INTO tool_calls (message_id, name, input, output, error, timestamp, \
             is_complete, meta) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
               tool_call.message_id,
               tool_call.name,
               tool_call.input,
               tool_call.output,
               tool_call.error,
               tool_call.timestamp,
               tool_call.is_complete,
               tool_call.meta
            ],
         ) {
            Ok(_) => {}
            Err(e) => {
               conn.execute("ROLLBACK", []).ok();
               return Err(format!("Failed to save tool call: {}", e));
            }
         }
      }

      conn
         .execute("COMMIT", [])
         .map_err(|e| format!("Failed to commit transaction: {}", e))?;

      Ok(())
   }

   pub fn load_all_chats(&self) -> Result<Vec<ChatData>, String> {
      let conn = self.open_connection()?;
      let mut stmt = conn
         .prepare(
            "SELECT id, title, created_at, last_message_at, agent_id, acp_session_id, \
             workspace_path, provider_id, model_id, branch, is_pinned, archived_at, \
             session_settings FROM chats ORDER BY is_pinned DESC, last_message_at DESC",
         )
         .map_err(|e| format!("Failed to prepare query: {}", e))?;

      stmt
         .query_map([], map_chat_row)
         .map_err(|e| format!("Failed to query chats: {}", e))?
         .collect::<SqliteResult<Vec<_>>>()
         .map_err(|e| format!("Failed to collect chats: {}", e))
   }

   pub fn update_chat_metadata(&self, chat: ChatData) -> Result<(), String> {
      let conn = self.open_connection()?;
      conn
         .execute(
            "UPDATE chats SET title = ?2, last_message_at = ?3, agent_id = ?4, acp_session_id = \
             ?5, workspace_path = ?6, provider_id = ?7, model_id = ?8, branch = ?9, is_pinned = \
             ?10, archived_at = ?11, session_settings = ?12 WHERE id = ?1",
            params![
               chat.id,
               chat.title,
               chat.last_message_at,
               chat.agent_id.unwrap_or_else(|| "custom".to_string()),
               chat.acp_session_id,
               chat.workspace_path,
               chat.provider_id,
               chat.model_id,
               chat.branch,
               chat.is_pinned,
               chat.archived_at,
               chat.session_settings
            ],
         )
         .map_err(|e| format!("Failed to update chat metadata: {}", e))?;
      Ok(())
   }

   pub fn load_chat(&self, chat_id: &str) -> Result<ChatWithMessages, String> {
      let conn = self.open_connection()?;

      let mut stmt = conn
         .prepare(
            "SELECT id, title, created_at, last_message_at, agent_id, acp_session_id, \
             workspace_path, provider_id, model_id, branch, is_pinned, archived_at, \
             session_settings FROM chats WHERE id = ?1",
         )
         .map_err(|e| format!("Failed to prepare chat query: {}", e))?;

      let chat = stmt
         .query_row([chat_id], map_chat_row)
         .map_err(|e| format!("Failed to load chat: {}", e))?;

      let mut stmt = conn
         .prepare(
            "SELECT id, chat_id, role, content, timestamp, is_streaming, is_tool_use, tool_name, \
             images, plan, stop_notice, turn_usage FROM messages WHERE chat_id = ?1 ORDER BY \
             timestamp ASC",
         )
         .map_err(|e| format!("Failed to prepare messages query: {}", e))?;

      let messages = stmt
         .query_map([chat_id], |row| {
            Ok(MessageData {
               id: row.get(0)?,
               chat_id: row.get(1)?,
               role: row.get(2)?,
               content: row.get(3)?,
               timestamp: row.get(4)?,
               is_streaming: row.get(5)?,
               is_tool_use: row.get(6)?,
               tool_name: row.get(7)?,
               images: row.get(8)?,
               plan: row.get(9)?,
               stop_notice: row.get(10)?,
               turn_usage: row.get(11)?,
            })
         })
         .map_err(|e| format!("Failed to query messages: {}", e))?
         .collect::<SqliteResult<Vec<_>>>()
         .map_err(|e| format!("Failed to collect messages: {}", e))?;

      let message_ids: Vec<String> = messages.iter().map(|m| m.id.clone()).collect();
      let tool_calls = self.load_tool_calls(&conn, &message_ids)?;

      Ok(ChatWithMessages {
         chat,
         messages,
         tool_calls,
      })
   }

   pub fn delete_chat(&self, chat_id: &str) -> Result<(), String> {
      let conn = self.open_connection()?;
      conn
         .execute("DELETE FROM chats WHERE id = ?1", params![chat_id])
         .map_err(|e| format!("Failed to delete chat: {}", e))?;
      Ok(())
   }

   pub fn search_chats(&self, query: &str) -> Result<Vec<ChatData>, String> {
      let conn = self.open_connection()?;
      let search_pattern = format!("%{}%", query);

      let mut stmt = conn
         .prepare(
            "SELECT DISTINCT c.id, c.title, c.created_at, c.last_message_at, c.agent_id, \
             c.acp_session_id, c.workspace_path, c.provider_id, c.model_id, c.branch, \
             c.is_pinned, c.archived_at, c.session_settings
             FROM chats c
                LEFT JOIN messages m ON c.id = m.chat_id
                WHERE c.title LIKE ?1 OR m.content LIKE ?1
                ORDER BY c.last_message_at DESC",
         )
         .map_err(|e| format!("Failed to prepare search query: {}", e))?;

      stmt
         .query_map([&search_pattern], map_chat_row)
         .map_err(|e| format!("Failed to query search results: {}", e))?
         .collect::<SqliteResult<Vec<_>>>()
         .map_err(|e| format!("Failed to collect search results: {}", e))
   }

   pub fn get_stats(&self) -> Result<ChatStats, String> {
      let conn = self.open_connection()?;

      let total_chats: i64 = conn
         .query_row("SELECT COUNT(*) FROM chats", [], |row| row.get(0))
         .map_err(|e| format!("Failed to count chats: {}", e))?;

      let total_messages: i64 = conn
         .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
         .map_err(|e| format!("Failed to count messages: {}", e))?;

      let total_tool_calls: i64 = conn
         .query_row("SELECT COUNT(*) FROM tool_calls", [], |row| row.get(0))
         .map_err(|e| format!("Failed to count tool calls: {}", e))?;

      Ok(ChatStats {
         total_chats,
         total_messages,
         total_tool_calls,
      })
   }

   fn open_connection(&self) -> Result<Connection, String> {
      if let Some(parent) = self.db_path.parent() {
         std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create chat history directory: {}", e))?;
      }

      Connection::open(&self.db_path)
         .map_err(|e| format!("Failed to open chat history database: {}", e))
   }

   fn load_tool_calls(
      &self,
      conn: &Connection,
      message_ids: &[String],
   ) -> Result<Vec<ToolCallData>, String> {
      if message_ids.is_empty() {
         return Ok(Vec::new());
      }

      let placeholders = message_ids
         .iter()
         .map(|_| "?")
         .collect::<Vec<_>>()
         .join(",");
      let query = format!(
         "SELECT message_id, name, input, output, error, timestamp, is_complete, meta
          FROM tool_calls WHERE message_id IN ({}) ORDER BY id",
         placeholders
      );

      let mut stmt = conn
         .prepare(&query)
         .map_err(|e| format!("Failed to prepare tool_calls query: {}", e))?;

      let params: Vec<&dyn ToSql> = message_ids.iter().map(|id| id as &dyn ToSql).collect();

      stmt
         .query_map(params.as_slice(), |row| {
            Ok(ToolCallData {
               message_id: row.get(0)?,
               name: row.get(1)?,
               input: row.get(2)?,
               output: row.get(3)?,
               error: row.get(4)?,
               timestamp: row.get(5)?,
               is_complete: row.get(6)?,
               meta: row.get(7)?,
            })
         })
         .map_err(|e| format!("Failed to query tool_calls: {}", e))?
         .collect::<SqliteResult<Vec<_>>>()
         .map_err(|e| format!("Failed to collect tool_calls: {}", e))
   }
}

fn map_chat_row(row: &rusqlite::Row<'_>) -> SqliteResult<ChatData> {
   Ok(ChatData {
      id: row.get(0)?,
      title: row.get(1)?,
      created_at: row.get(2)?,
      last_message_at: row.get(3)?,
      agent_id: row.get(4)?,
      acp_session_id: row.get(5)?,
      workspace_path: row.get(6)?,
      provider_id: row.get(7)?,
      model_id: row.get(8)?,
      branch: row.get(9)?,
      is_pinned: row.get(10)?,
      archived_at: row.get(11)?,
      session_settings: row.get(12)?,
   })
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn migrates_legacy_messages_and_round_trips_images_plans_and_stop_notices() {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("history.db");
      let conn = Connection::open(&path).unwrap();
      conn
         .execute_batch(
            "CREATE TABLE messages (
         id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
         content TEXT NOT NULL, timestamp INTEGER NOT NULL, is_streaming BOOLEAN,
         is_tool_use BOOLEAN, tool_name TEXT
      );",
         )
         .unwrap();
      drop(conn);
      let repository = ChatHistoryRepository::new(path.clone());
      repository.initialize().unwrap();
      repository.initialize().unwrap();
      let chat: ChatData = serde_json::from_value(serde_json::json!({
         "id": "images", "title": "Images", "created_at": 1, "last_message_at": 2,
         "is_pinned": false
      }))
      .unwrap();
      let mut message: MessageData = serde_json::from_value(serde_json::json!({
         "id": "user", "chat_id": "images", "role": "user", "content": "",
         "timestamp": 2, "is_streaming": false, "is_tool_use": false
      }))
      .unwrap();
      assert!(message.images.is_none());
      assert!(message.plan.is_none());
      assert!(message.stop_notice.is_none());
      let images = r#"[{"mediaType":"image/png","data":"YWJj"}]"#.to_string();
      message.images = Some(images.clone());
      let plan = r#"[{"content":"Read","priority":"high","status":"completed"}]"#.to_string();
      message.plan = Some(plan.clone());
      message.stop_notice = Some("max_tokens".to_string());
      let usage = r#"{"totalTokens":3,"inputTokens":2,"outputTokens":1}"#.to_string();
      message.turn_usage = Some(usage.clone());
      repository.save_chat(chat, vec![message], vec![]).unwrap();
      let reopened = ChatHistoryRepository::new(path);
      let loaded = reopened.load_chat("images").unwrap();
      assert_eq!(loaded.messages[0].images.as_deref(), Some(images.as_str()));
      assert_eq!(loaded.messages[0].plan.as_deref(), Some(plan.as_str()));
      assert_eq!(
         loaded.messages[0].stop_notice.as_deref(),
         Some("max_tokens")
      );
      assert_eq!(
         loaded.messages[0].turn_usage.as_deref(),
         Some(usage.as_str())
      );
      assert_eq!(loaded.messages[0].content, "");
      assert!(loaded.chat.session_settings.is_none());
   }

   #[test]
   fn keeps_a_chats_session_settings() {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("history.db");
      let repository = ChatHistoryRepository::new(path);
      repository.initialize().unwrap();
      let mut chat: ChatData = serde_json::from_value(serde_json::json!({
         "id": "chat", "title": "Chat", "created_at": 1, "last_message_at": 2,
         "is_pinned": false
      }))
      .unwrap();
      repository.save_chat(chat.clone(), vec![], vec![]).unwrap();

      let settings = r#"{"modeId":"plan","configOptions":{"model":"fast"}}"#.to_string();
      chat.session_settings = Some(settings.clone());
      repository.update_chat_metadata(chat).unwrap();
      assert_eq!(
         repository.load_chat("chat").unwrap().chat.session_settings,
         Some(settings.clone())
      );
      assert_eq!(
         repository.load_all_chats().unwrap()[0].session_settings,
         Some(settings)
      );
   }
}
