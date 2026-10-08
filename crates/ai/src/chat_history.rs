use rusqlite::{Connection, Result as SqliteResult, ToSql, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{
   collections::{HashMap, HashSet},
   path::PathBuf,
};

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
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

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
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

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ToolCallData {
   pub message_id: String,
   /// The call's id, unique within its message. Saves match stored rows by it.
   pub call_id: String,
   pub name: String,
   pub input: Option<String>,
   pub output: Option<String>,
   pub error: Option<String>,
   pub timestamp: i64,
   pub is_complete: bool,
   /// Presentation details (kind, status, locations, content offset) as JSON. It also repeats the
   /// call's id for older builds, which read it from here; `call_id` is the one this build uses.
   #[serde(default)]
   pub meta: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ChatWithMessages {
   pub chat: ChatData,
   pub messages: Vec<MessageData>,
   pub tool_calls: Vec<ToolCallData>,
}

/// How much of a chat a save carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatSaveScope {
   /// Every message of the chat: stored messages missing from the save are deleted.
   AllMessages,
   /// Only the messages that changed: the chat's other stored messages stay as they are.
   ChangedMessages,
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
      let mut conn = self.open_connection()?;

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
               meta TEXT,
               call_id TEXT,
               position INTEGER,
               FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
           )",
            [],
         )
         .map_err(|e| format!("Failed to create tool_calls table: {}", e))?;
      let _ = conn.execute("ALTER TABLE tool_calls ADD COLUMN meta TEXT", []);
      migrate_tool_call_keys(&mut conn)?;

      for column in ["images", "plan", "stop_notice", "turn_usage"] {
         add_column_if_missing(&conn, "messages", column, "TEXT")?;
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

      // The unique (message_id, call_id) index from `migrate_tool_call_keys` covers lookups by
      // message, so the older single-column index is redundant.
      conn
         .execute("DROP INDEX IF EXISTS idx_tool_calls_message_id", [])
         .map_err(|e| format!("Failed to drop tool_calls index: {}", e))?;

      conn
         .execute(
            "CREATE TABLE IF NOT EXISTS chat_checkpoints (
               chat_id TEXT PRIMARY KEY,
               data TEXT NOT NULL,
               updated_at INTEGER NOT NULL
           )",
            [],
         )
         .map_err(|e| format!("Failed to create chat_checkpoints table: {}", e))?;

      Ok(())
   }

   /// Stores a chat's agent checkpoints, as the JSON the frontend keeps them in, replacing any
   /// stored before. `None` forgets them.
   pub fn save_checkpoints(
      &self,
      chat_id: &str,
      data: Option<String>,
      updated_at: i64,
   ) -> Result<(), String> {
      let conn = self.open_connection()?;
      conn
         .execute(
            "INSERT INTO chat_checkpoints (chat_id, data, updated_at)
             SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM chats WHERE id = ?1)
             ON CONFLICT(chat_id) DO UPDATE SET data = excluded.data, updated_at = \
             excluded.updated_at
             WHERE excluded.updated_at >= chat_checkpoints.updated_at",
            params![
               chat_id,
               data.unwrap_or_else(|| "null".to_string()),
               updated_at
            ],
         )
         .map_err(|e| format!("Failed to save chat checkpoints: {}", e))?;
      Ok(())
   }

   pub fn load_checkpoints(&self, chat_id: &str) -> Result<Option<String>, String> {
      let conn = self.open_connection()?;
      match conn.query_row(
         "SELECT NULLIF(data, 'null') FROM chat_checkpoints WHERE chat_id = ?1",
         params![chat_id],
         |row| row.get(0),
      ) {
         Ok(data) => Ok(data),
         Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
         Err(e) => Err(format!("Failed to load chat checkpoints: {}", e)),
      }
   }

   /// Stores a chat snapshot. A streamed reply saves its chat several times a second, so this
   /// writes only what changed: rows are upserted (and left untouched when equal), and only the
   /// messages and tool calls missing from the snapshot are deleted, all in one transaction.
   pub fn save_chat(
      &self,
      chat: ChatData,
      messages: Vec<MessageData>,
      tool_calls: Vec<ToolCallData>,
   ) -> Result<(), String> {
      self.write_chat(chat, messages, tool_calls, ChatSaveScope::AllMessages)
   }

   /// Stores the chat row and the given messages with their tool calls, leaving the chat's other
   /// stored messages alone. A streamed reply changes one message at a time, so its saves send
   /// only that message instead of the whole chat.
   pub fn save_chat_messages(
      &self,
      chat: ChatData,
      messages: Vec<MessageData>,
      tool_calls: Vec<ToolCallData>,
   ) -> Result<(), String> {
      self.write_chat(chat, messages, tool_calls, ChatSaveScope::ChangedMessages)
   }

   fn write_chat(
      &self,
      chat: ChatData,
      messages: Vec<MessageData>,
      tool_calls: Vec<ToolCallData>,
      scope: ChatSaveScope,
   ) -> Result<(), String> {
      if messages.iter().any(|message| message.chat_id != chat.id) {
         return Err("A message belongs to a different chat".to_string());
      }
      let message_ids: HashSet<&str> = messages.iter().map(|message| message.id.as_str()).collect();
      if tool_calls
         .iter()
         .any(|call| !message_ids.contains(call.message_id.as_str()))
      {
         return Err("A tool call belongs to a message outside this chat snapshot".to_string());
      }
      let mut conn = self.open_connection()?;
      let transaction = conn
         .transaction()
         .map_err(|e| format!("Failed to begin transaction: {}", e))?;

      transaction
         .execute(
            "INSERT INTO chats (id, title, created_at, last_message_at, agent_id, acp_session_id, \
             workspace_path, provider_id, model_id, branch, is_pinned, archived_at, \
             session_settings) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, created_at = \
             excluded.created_at,
             last_message_at = excluded.last_message_at, agent_id = excluded.agent_id,
             acp_session_id = excluded.acp_session_id, workspace_path = excluded.workspace_path,
             provider_id = excluded.provider_id, model_id = excluded.model_id, branch = \
             excluded.branch,
             is_pinned = excluded.is_pinned, archived_at = excluded.archived_at,
             session_settings = excluded.session_settings",
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
         )
         .map_err(|e| format!("Failed to save chat: {}", e))?;

      // A partial save checks ownership per message instead of reading every stored id.
      let stored_message_ids = match scope {
         ChatSaveScope::AllMessages => {
            let mut stmt = transaction
               .prepare_cached("SELECT id FROM messages WHERE chat_id = ?1")
               .map_err(|e| format!("Failed to read stored messages: {}", e))?;
            stmt
               .query_map(params![chat.id], |row| row.get::<_, String>(0))
               .map_err(|e| format!("Failed to read stored messages: {}", e))?
               .collect::<SqliteResult<HashSet<_>>>()
               .map_err(|e| format!("Failed to read stored messages: {}", e))?
         }
         ChatSaveScope::ChangedMessages => HashSet::new(),
      };

      for removed in stored_message_ids
         .iter()
         .filter(|id| !message_ids.contains(id.as_str()))
      {
         transaction
            .execute(
               "DELETE FROM tool_calls WHERE message_id = ?1",
               params![removed],
            )
            .map_err(|e| format!("Failed to delete old tool calls: {}", e))?;
         transaction
            .execute("DELETE FROM messages WHERE id = ?1", params![removed])
            .map_err(|e| format!("Failed to delete old messages: {}", e))?;
      }

      {
         let mut stmt = transaction
            .prepare_cached(
               "INSERT INTO messages (id, chat_id, role, content, timestamp, is_streaming, \
                is_tool_use, tool_name, images, plan, stop_notice, turn_usage) VALUES (?1, ?2, \
                ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(id) DO UPDATE SET role = excluded.role, content = excluded.content,
                timestamp = excluded.timestamp, is_streaming = excluded.is_streaming,
                is_tool_use = excluded.is_tool_use, tool_name = excluded.tool_name,
                images = excluded.images, plan = excluded.plan, stop_notice = excluded.stop_notice,
                turn_usage = excluded.turn_usage
                WHERE messages.chat_id = excluded.chat_id AND (messages.role IS NOT excluded.role
                OR messages.content IS NOT excluded.content
                OR messages.timestamp IS NOT excluded.timestamp
                OR messages.is_streaming IS NOT excluded.is_streaming
                OR messages.is_tool_use IS NOT excluded.is_tool_use
                OR messages.tool_name IS NOT excluded.tool_name
                OR messages.images IS NOT excluded.images
                OR messages.plan IS NOT excluded.plan
                OR messages.stop_notice IS NOT excluded.stop_notice
                OR messages.turn_usage IS NOT excluded.turn_usage)",
            )
            .map_err(|e| format!("Failed to save message: {}", e))?;
         for message in &messages {
            let changed = stmt
               .execute(params![
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
               ])
               .map_err(|e| format!("Failed to save message: {}", e))?;
            // A new id that changed nothing collided with another chat's message.
            if changed == 0
               && !Self::owns_message(
                  &transaction,
                  scope,
                  &stored_message_ids,
                  &chat.id,
                  &message.id,
               )?
            {
               return Err(format!(
                  "Failed to save message: {} belongs to another chat",
                  message.id
               ));
            }
         }
      }

      Self::save_tool_calls(&transaction, &message_ids, &tool_calls)?;

      transaction
         .commit()
         .map_err(|e| format!("Failed to commit transaction: {}", e))?;

      Ok(())
   }

   fn owns_message(
      conn: &Connection,
      scope: ChatSaveScope,
      stored_message_ids: &HashSet<String>,
      chat_id: &str,
      message_id: &str,
   ) -> Result<bool, String> {
      match scope {
         ChatSaveScope::AllMessages => Ok(stored_message_ids.contains(message_id)),
         ChatSaveScope::ChangedMessages => conn
            .prepare_cached("SELECT EXISTS(SELECT 1 FROM messages WHERE id = ?1 AND chat_id = ?2)")
            .and_then(|mut stmt| stmt.query_row(params![message_id, chat_id], |row| row.get(0)))
            .map_err(|e| format!("Failed to read stored messages: {}", e)),
      }
   }

   /// Upserts the saved messages' tool calls by `(message_id, call_id)`, records each call's
   /// position in its message, and deletes the stored calls those messages no longer have.
   /// Unchanged rows are not rewritten. Messages outside `message_ids` keep their rows.
   fn save_tool_calls(
      conn: &Connection,
      message_ids: &HashSet<&str>,
      tool_calls: &[ToolCallData],
   ) -> Result<(), String> {
      let mut upsert = conn
         .prepare_cached(
            "INSERT INTO tool_calls (message_id, call_id, position, name, input, output, error, \
             timestamp, is_complete, meta) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(message_id, call_id) DO UPDATE SET position = excluded.position,
             name = excluded.name, input = excluded.input, output = excluded.output,
             error = excluded.error, timestamp = excluded.timestamp,
             is_complete = excluded.is_complete, meta = excluded.meta
             WHERE tool_calls.position IS NOT excluded.position
             OR tool_calls.name IS NOT excluded.name OR tool_calls.input IS NOT excluded.input
             OR tool_calls.output IS NOT excluded.output OR tool_calls.error IS NOT excluded.error
             OR tool_calls.timestamp IS NOT excluded.timestamp
             OR tool_calls.is_complete IS NOT excluded.is_complete
             OR tool_calls.meta IS NOT excluded.meta",
         )
         .map_err(|e| format!("Failed to save tool call: {}", e))?;

      let mut saved_ids: HashMap<&str, HashSet<String>> = HashMap::new();
      for tool_call in tool_calls {
         let ids = saved_ids.entry(tool_call.message_id.as_str()).or_default();
         let position = ids.len();
         let call_id = unique_call_id(&tool_call.call_id, &tool_call.message_id, position, ids);
         upsert
            .execute(params![
               tool_call.message_id,
               call_id,
               position as i64,
               tool_call.name,
               tool_call.input,
               tool_call.output,
               tool_call.error,
               tool_call.timestamp,
               tool_call.is_complete,
               tool_call.meta
            ])
            .map_err(|e| format!("Failed to save tool call: {}", e))?;
         ids.insert(call_id);
      }

      let mut stored = conn
         .prepare_cached("SELECT id, call_id FROM tool_calls WHERE message_id = ?1")
         .map_err(|e| format!("Failed to read stored tool calls: {}", e))?;
      let mut delete = conn
         .prepare_cached("DELETE FROM tool_calls WHERE id = ?1")
         .map_err(|e| format!("Failed to delete old tool calls: {}", e))?;
      let no_calls = HashSet::new();
      for message_id in message_ids {
         let kept = saved_ids.get(message_id).unwrap_or(&no_calls);
         let removed = stored
            .query_map(params![message_id], |row| {
               Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| format!("Failed to read stored tool calls: {}", e))?
            .collect::<SqliteResult<Vec<_>>>()
            .map_err(|e| format!("Failed to read stored tool calls: {}", e))?
            .into_iter()
            .filter(|(_, call_id)| !call_id.as_ref().is_some_and(|id| kept.contains(id)));
         for (row_id, _) in removed {
            delete
               .execute(params![row_id])
               .map_err(|e| format!("Failed to delete old tool calls: {}", e))?;
         }
      }

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
      let mut conn = self.open_connection()?;
      let transaction = conn
         .transaction()
         .map_err(|e| format!("Failed to begin chat deletion: {e}"))?;
      transaction
         .execute(
            "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE chat_id = \
             ?1)",
            params![chat_id],
         )
         .map_err(|e| format!("Failed to delete chat tool calls: {e}"))?;
      transaction
         .execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
         .map_err(|e| format!("Failed to delete chat messages: {e}"))?;
      transaction
         .execute(
            "DELETE FROM chat_checkpoints WHERE chat_id = ?1",
            params![chat_id],
         )
         .map_err(|e| format!("Failed to delete chat checkpoints: {e}"))?;
      transaction
         .execute("DELETE FROM chats WHERE id = ?1", params![chat_id])
         .map_err(|e| format!("Failed to delete chat: {e}"))?;
      transaction
         .commit()
         .map_err(|e| format!("Failed to commit chat deletion: {e}"))?;
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

      let conn = Connection::open(&self.db_path)
         .map_err(|e| format!("Failed to open chat history database: {}", e))?;
      conn
         .pragma_update(None, "foreign_keys", true)
         .map_err(|e| format!("Failed to enable chat history constraints: {e}"))?;
      Ok(conn)
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
         "SELECT message_id, COALESCE(call_id, 'row-' || id), name, input, output, error, \
          timestamp, is_complete, meta FROM tool_calls WHERE message_id IN ({}) ORDER BY \
          message_id, position, id",
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
               call_id: row.get(1)?,
               name: row.get(2)?,
               input: row.get(3)?,
               output: row.get(4)?,
               error: row.get(5)?,
               timestamp: row.get(6)?,
               is_complete: row.get(7)?,
               meta: row.get(8)?,
            })
         })
         .map_err(|e| format!("Failed to query tool_calls: {}", e))?
         .collect::<SqliteResult<Vec<_>>>()
         .map_err(|e| format!("Failed to collect tool_calls: {}", e))
   }
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
   conn
      .query_row(
         "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
         params![table, column],
         |row| row.get(0),
      )
      .map_err(|e| format!("Failed to inspect {table} columns: {e}"))
}

/// Adds `column` to `table` unless it is there. Another connection initializing the same database
/// can add it between the check and the `ALTER`, so a duplicate column counts as success.
fn add_column_if_missing(
   conn: &Connection,
   table: &str,
   column: &str,
   definition: &str,
) -> Result<(), String> {
   if table_has_column(conn, table, column)? {
      return Ok(());
   }
   match conn.execute(
      &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
      [],
   ) {
      Ok(_) => Ok(()),
      Err(e) if e.to_string().contains("duplicate column name") => Ok(()),
      Err(e) => Err(format!("Failed to add {table} {column}: {e}")),
   }
}

/// Gives every stored tool call a `call_id` unique within its message and a `position`, then
/// adds the `(message_id, call_id)` unique index saves upsert on. Calls whose `meta` JSON has an
/// id keep it; the others get an id derived from their message and position. Only messages with a
/// row missing either are touched, so running it again (or after an older build added rows) is
/// safe.
fn migrate_tool_call_keys(conn: &mut Connection) -> Result<(), String> {
   // IMMEDIATE takes the write lock up front, so a second window initializing the same database
   // waits here and then finds the migration done.
   let transaction = conn
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(|e| format!("Failed to begin tool call migration: {e}"))?;
   for (column, kind) in [("call_id", "TEXT"), ("position", "INTEGER")] {
      add_column_if_missing(&transaction, "tool_calls", column, kind)?;
   }
   let pending_messages = transaction
      .prepare(
         "SELECT DISTINCT message_id FROM tool_calls WHERE call_id IS NULL OR call_id = '' OR \
          position IS NULL",
      )
      .and_then(|mut stmt| {
         stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<SqliteResult<Vec<_>>>()
      })
      .map_err(|e| format!("Failed to read tool calls to migrate: {e}"))?;

   {
      let mut rows_of = transaction
         .prepare(
            "SELECT id, call_id, meta FROM tool_calls WHERE message_id = ?1 ORDER BY position IS \
             NULL, position, id",
         )
         .map_err(|e| format!("Failed to read tool calls to migrate: {e}"))?;
      let mut update = transaction
         .prepare("UPDATE tool_calls SET call_id = ?2, position = ?3 WHERE id = ?1")
         .map_err(|e| format!("Failed to migrate tool calls: {e}"))?;
      for message_id in &pending_messages {
         let rows = rows_of
            .query_map(params![message_id], |row| {
               Ok((
                  row.get::<_, i64>(0)?,
                  row.get::<_, Option<String>>(1)?,
                  row.get::<_, Option<String>>(2)?,
               ))
            })
            .map_err(|e| format!("Failed to read tool calls to migrate: {e}"))?
            .collect::<SqliteResult<Vec<_>>>()
            .map_err(|e| format!("Failed to read tool calls to migrate: {e}"))?;

         // Ids already stored are claimed first so a backfilled id never takes one of them.
         let mut used = HashSet::new();
         let kept: Vec<bool> = rows
            .iter()
            .map(|(_, call_id, _)| {
               call_id
                  .as_ref()
                  .is_some_and(|id| !id.is_empty() && used.insert(id.clone()))
            })
            .collect();
         for (position, ((row_id, call_id, meta), keep)) in rows.iter().zip(kept).enumerate() {
            let call_id = match call_id {
               Some(id) if keep => id.clone(),
               _ => {
                  let meta_id = meta.as_deref().and_then(meta_call_id).unwrap_or_default();
                  let id = unique_call_id(&meta_id, message_id, position, &used);
                  used.insert(id.clone());
                  id
               }
            };
            update
               .execute(params![row_id, call_id, position as i64])
               .map_err(|e| format!("Failed to migrate tool calls: {e}"))?;
         }
      }
   }

   transaction
      .execute(
         "CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_message_call ON tool_calls(message_id, \
          call_id)",
         [],
      )
      .map_err(|e| format!("Failed to create tool call id index: {e}"))?;
   transaction
      .commit()
      .map_err(|e| format!("Failed to commit tool call migration: {e}"))
}

/// The `id` an older build kept in a tool call's `meta` JSON, if it is a non-empty string.
fn meta_call_id(meta: &str) -> Option<String> {
   let value: serde_json::Value = serde_json::from_str(meta).ok()?;
   value
      .get("id")?
      .as_str()
      .filter(|id| !id.is_empty())
      .map(str::to_string)
}

/// `requested` when it is a free id within its message. A call sent without an id gets one derived
/// from its message and position, and a repeated id gets a numbered suffix, so the result is the
/// same on every save of the same calls.
fn unique_call_id(
   requested: &str,
   message_id: &str,
   position: usize,
   used: &HashSet<String>,
) -> String {
   let base = if requested.is_empty() {
      format!("{message_id}:tool-{position}")
   } else {
      requested.to_string()
   };
   if !used.contains(&base) {
      return base;
   }
   let mut occurrence = 2;
   loop {
      let candidate = format!("{base}#{occurrence}");
      if !used.contains(&candidate) {
         return candidate;
      }
      occurrence += 1;
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

   #[test]
   fn stores_replaces_and_deletes_a_chats_checkpoints() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      assert_eq!(repository.load_checkpoints("chat").unwrap(), None);
      let chat: ChatData = serde_json::from_value(serde_json::json!({
         "id": "chat", "title": "Chat", "created_at": 1, "last_message_at": 2,
         "is_pinned": false
      }))
      .unwrap();
      repository.save_chat(chat, vec![], vec![]).unwrap();

      repository
         .save_checkpoints("chat", Some("[1]".to_string()), 1)
         .unwrap();
      repository
         .save_checkpoints("chat", Some("[2]".to_string()), 2)
         .unwrap();
      assert_eq!(
         repository.load_checkpoints("chat").unwrap().as_deref(),
         Some("[2]")
      );

      repository.save_checkpoints("chat", None, 3).unwrap();
      assert_eq!(repository.load_checkpoints("chat").unwrap(), None);

      repository
         .save_checkpoints("chat", Some("[3]".to_string()), 4)
         .unwrap();
      repository.delete_chat("chat").unwrap();
      assert_eq!(repository.load_checkpoints("chat").unwrap(), None);
   }

   fn sample_chat(id: &str) -> ChatData {
      serde_json::from_value(serde_json::json!({
         "id": id, "title": "Chat", "created_at": 1, "last_message_at": 2, "is_pinned": false
      }))
      .unwrap()
   }

   fn sample_message(chat_id: &str, id: &str) -> MessageData {
      serde_json::from_value(serde_json::json!({
         "id": id, "chat_id": chat_id, "role": "assistant", "content": "Reply",
         "timestamp": 2, "is_streaming": false, "is_tool_use": false
      }))
      .unwrap()
   }

   fn sample_tool_call(message_id: &str, call_id: &str) -> ToolCallData {
      serde_json::from_value(serde_json::json!({
         "message_id": message_id, "call_id": call_id, "name": "read_file", "timestamp": 2,
         "is_complete": true
      }))
      .unwrap()
   }

   #[test]
   fn ignores_checkpoint_saves_for_missing_and_deleted_chats() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      repository
         .save_checkpoints("missing", Some("snapshots".to_string()), 1)
         .unwrap();
      assert_eq!(repository.load_checkpoints("missing").unwrap(), None);
      repository
         .save_chat(sample_chat("chat"), vec![], vec![])
         .unwrap();
      repository
         .save_checkpoints("chat", Some("snapshots".to_string()), 2)
         .unwrap();
      repository.delete_chat("chat").unwrap();
      repository
         .save_checkpoints("chat", Some("late snapshots".to_string()), 3)
         .unwrap();
      assert_eq!(repository.load_checkpoints("chat").unwrap(), None);
      let conn = repository.open_connection().unwrap();
      assert_eq!(
         conn
            .query_row("SELECT COUNT(*) FROM chat_checkpoints", [], |row| row
               .get::<_, i64>(0))
            .unwrap(),
         0
      );
   }

   #[test]
   fn keeps_newer_checkpoints_and_does_not_resurrect_a_cleared_snapshot() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      repository
         .save_chat(sample_chat("chat"), vec![], vec![])
         .unwrap();
      repository
         .save_checkpoints("chat", Some("newer".to_string()), 20)
         .unwrap();
      repository
         .save_checkpoints("chat", Some("older".to_string()), 10)
         .unwrap();
      assert_eq!(
         repository.load_checkpoints("chat").unwrap().as_deref(),
         Some("newer")
      );
      repository.save_checkpoints("chat", None, 30).unwrap();
      repository
         .save_checkpoints("chat", Some("late".to_string()), 25)
         .unwrap();
      assert_eq!(repository.load_checkpoints("chat").unwrap(), None);
      repository
         .save_checkpoints("chat", Some("next turn".to_string()), 40)
         .unwrap();
      repository.save_checkpoints("chat", None, 35).unwrap();
      assert_eq!(
         repository.load_checkpoints("chat").unwrap().as_deref(),
         Some("next turn")
      );
   }

   #[test]
   fn replaces_streamed_tool_calls_and_deletes_only_the_chosen_chats_history() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      for id in ["one", "two"] {
         repository
            .save_chat(
               sample_chat(id),
               vec![sample_message(id, id)],
               vec![sample_tool_call(id, "call")],
            )
            .unwrap();
      }
      repository
         .save_checkpoints("one", Some("checkpoint".to_string()), 1)
         .unwrap();
      let mut reply = sample_message("one", "one");
      reply.content = "Updated reply".to_string();
      repository
         .save_chat(
            sample_chat("one"),
            vec![reply],
            vec![sample_tool_call("one", "call")],
         )
         .unwrap();
      assert_eq!(repository.load_chat("one").unwrap().tool_calls.len(), 1);
      assert_eq!(repository.get_stats().unwrap().total_tool_calls, 2);
      assert_eq!(
         repository.load_checkpoints("one").unwrap().as_deref(),
         Some("checkpoint")
      );
      repository.delete_chat("one").unwrap();
      let stats = repository.get_stats().unwrap();
      assert_eq!(stats.total_chats, 1);
      assert_eq!(stats.total_messages, 1);
      assert_eq!(stats.total_tool_calls, 1);
      assert_eq!(repository.load_chat("two").unwrap().messages.len(), 1);
      assert_eq!(repository.load_checkpoints("one").unwrap(), None);
   }

   fn tool_call_rows(repository: &ChatHistoryRepository) -> Vec<(i64, String, Option<String>)> {
      let conn = repository.open_connection().unwrap();
      let mut stmt = conn
         .prepare("SELECT id, message_id, output FROM tool_calls ORDER BY id")
         .unwrap();
      stmt
         .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
         .unwrap()
         .collect::<SqliteResult<Vec<_>>>()
         .unwrap()
   }

   #[test]
   fn resaves_a_chat_by_updating_changed_rows_in_place() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      let mut prompt = sample_message("chat", "prompt");
      prompt.role = "user".to_string();
      prompt.timestamp = 1;
      let mut reply = sample_message("chat", "reply");
      reply.is_streaming = true;
      let mut running = sample_tool_call("reply", "running");
      running.is_complete = false;
      repository
         .save_chat(
            sample_chat("chat"),
            vec![prompt.clone(), reply.clone()],
            vec![sample_tool_call("reply", "first"), running.clone()],
         )
         .unwrap();
      let first_rows = tool_call_rows(&repository);
      assert_eq!(first_rows.len(), 2);

      reply.content = "Reply, continued".to_string();
      reply.is_streaming = false;
      running.is_complete = true;
      running.output = Some("done".to_string());
      let mut title = sample_chat("chat");
      title.title = "Renamed".to_string();
      repository
         .save_chat(
            title,
            vec![prompt.clone(), reply.clone()],
            vec![
               sample_tool_call("reply", "first"),
               running.clone(),
               sample_tool_call("reply", "third"),
            ],
         )
         .unwrap();

      let loaded = repository.load_chat("chat").unwrap();
      assert_eq!(loaded.chat.title, "Renamed");
      assert_eq!(
         loaded
            .messages
            .iter()
            .map(|message| (message.id.as_str(), message.content.as_str()))
            .collect::<Vec<_>>(),
         vec![("prompt", "Reply"), ("reply", "Reply, continued")]
      );
      assert!(!loaded.messages[1].is_streaming);
      assert_eq!(loaded.tool_calls.len(), 3);
      assert!(loaded.tool_calls[1].is_complete);
      assert_eq!(loaded.tool_calls[1].output.as_deref(), Some("done"));
      let rows = tool_call_rows(&repository);
      assert_eq!(rows[0].0, first_rows[0].0);
      assert_eq!(rows[1].0, first_rows[1].0);
      assert!(rows[2].0 > rows[1].0);

      repository
         .save_chat(
            sample_chat("chat"),
            vec![prompt.clone(), reply.clone()],
            vec![sample_tool_call("reply", "first")],
         )
         .unwrap();
      let rows = tool_call_rows(&repository);
      assert_eq!(rows.len(), 1);
      assert_eq!(rows[0].0, first_rows[0].0);
   }

   #[test]
   fn resaving_without_a_message_deletes_it_and_its_tool_calls() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      let mut prompt = sample_message("chat", "prompt");
      prompt.timestamp = 1;
      repository
         .save_chat(
            sample_chat("chat"),
            vec![prompt.clone(), sample_message("chat", "reply")],
            vec![
               sample_tool_call("prompt", "call"),
               sample_tool_call("reply", "call"),
            ],
         )
         .unwrap();
      let kept_row = tool_call_rows(&repository)[0].0;

      repository
         .save_chat(
            sample_chat("chat"),
            vec![prompt],
            vec![sample_tool_call("prompt", "call")],
         )
         .unwrap();

      let loaded = repository.load_chat("chat").unwrap();
      assert_eq!(loaded.messages.len(), 1);
      assert_eq!(loaded.messages[0].id, "prompt");
      assert_eq!(loaded.tool_calls.len(), 1);
      assert_eq!(loaded.tool_calls[0].message_id, "prompt");
      assert_eq!(tool_call_rows(&repository)[0].0, kept_row);
      let stats = repository.get_stats().unwrap();
      assert_eq!(stats.total_messages, 1);
      assert_eq!(stats.total_tool_calls, 1);

      repository
         .save_chat(sample_chat("chat"), vec![], vec![])
         .unwrap();
      let stats = repository.get_stats().unwrap();
      assert_eq!(stats.total_chats, 1);
      assert_eq!(stats.total_messages, 0);
      assert_eq!(stats.total_tool_calls, 0);
   }

   #[test]
   fn rejects_a_message_id_owned_by_another_chat_and_keeps_both_chats() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      repository
         .save_chat(
            sample_chat("one"),
            vec![sample_message("one", "shared")],
            vec![sample_tool_call("shared", "call")],
         )
         .unwrap();
      repository
         .save_chat(
            sample_chat("two"),
            vec![sample_message("two", "own")],
            vec![],
         )
         .unwrap();

      let mut renamed = sample_chat("two");
      renamed.title = "Renamed".to_string();
      let mut stolen = sample_message("two", "shared");
      stolen.content = "Overwritten".to_string();
      assert!(repository.save_chat(renamed, vec![stolen], vec![]).is_err());

      let one = repository.load_chat("one").unwrap();
      assert_eq!(one.messages[0].content, "Reply");
      assert_eq!(one.tool_calls.len(), 1);
      let two = repository.load_chat("two").unwrap();
      assert_eq!(two.chat.title, "Chat");
      assert_eq!(two.messages[0].id, "own");
   }

   #[test]
   fn rejects_foreign_messages_and_tool_calls_without_changing_either_chat() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      for id in ["one", "two"] {
         repository
            .save_chat(sample_chat(id), vec![sample_message(id, id)], vec![])
            .unwrap();
      }
      assert!(
         repository
            .save_chat(
               sample_chat("one"),
               vec![sample_message("two", "foreign")],
               vec![]
            )
            .is_err()
      );
      assert!(
         repository
            .save_chat(
               sample_chat("one"),
               vec![sample_message("one", "one")],
               vec![sample_tool_call("two", "call")]
            )
            .is_err()
      );
      assert_eq!(repository.load_chat("one").unwrap().messages[0].id, "one");
      assert_eq!(repository.load_chat("two").unwrap().messages[0].id, "two");
      assert_eq!(repository.get_stats().unwrap().total_tool_calls, 0);
   }

   #[test]
   fn a_partial_save_upserts_its_messages_and_keeps_the_others() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      let mut prompt = sample_message("chat", "prompt");
      prompt.role = "user".to_string();
      prompt.timestamp = 1;
      repository
         .save_chat(
            sample_chat("chat"),
            vec![prompt.clone(), sample_message("chat", "reply")],
            vec![
               sample_tool_call("prompt", "call"),
               sample_tool_call("reply", "call"),
            ],
         )
         .unwrap();
      let prompt_row = tool_call_rows(&repository)[0].0;

      let mut reply = sample_message("chat", "reply");
      reply.content = "Reply, continued".to_string();
      let mut next = sample_message("chat", "next");
      next.timestamp = 3;
      let mut renamed = sample_chat("chat");
      renamed.title = "Renamed".to_string();
      repository
         .save_chat_messages(
            renamed,
            vec![reply, next],
            vec![sample_tool_call("next", "call")],
         )
         .unwrap();

      let loaded = repository.load_chat("chat").unwrap();
      assert_eq!(loaded.chat.title, "Renamed");
      assert_eq!(
         loaded
            .messages
            .iter()
            .map(|message| (message.id.as_str(), message.content.as_str()))
            .collect::<Vec<_>>(),
         vec![
            ("prompt", "Reply"),
            ("reply", "Reply, continued"),
            ("next", "Reply")
         ]
      );
      let rows = tool_call_rows(&repository);
      assert_eq!(
         rows
            .iter()
            .map(|(_, message_id, _)| message_id.as_str())
            .collect::<Vec<_>>(),
         vec!["prompt", "next"]
      );
      assert_eq!(rows[0].0, prompt_row);

      repository
         .save_chat_messages(sample_chat("chat"), vec![], vec![])
         .unwrap();
      assert_eq!(repository.load_chat("chat").unwrap().messages.len(), 3);
   }

   #[test]
   fn a_partial_save_rejects_another_chats_message() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      for id in ["one", "two"] {
         repository
            .save_chat(sample_chat(id), vec![sample_message(id, id)], vec![])
            .unwrap();
      }
      assert!(
         repository
            .save_chat_messages(
               sample_chat("two"),
               vec![sample_message("two", "one")],
               vec![]
            )
            .is_err()
      );
      assert!(
         repository
            .save_chat_messages(
               sample_chat("two"),
               vec![sample_message("two", "two")],
               vec![]
            )
            .is_ok()
      );
      assert_eq!(
         repository.load_chat("one").unwrap().messages[0].chat_id,
         "one"
      );
   }

   #[test]
   fn rolls_back_the_whole_deletion_when_one_statement_fails() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      repository
         .save_chat(
            sample_chat("chat"),
            vec![sample_message("chat", "reply")],
            vec![sample_tool_call("reply", "call")],
         )
         .unwrap();
      repository
         .save_checkpoints("chat", Some("snapshot".to_string()), 1)
         .unwrap();
      repository
         .open_connection()
         .unwrap()
         .execute_batch(
            "CREATE TRIGGER fail_chat_deletion BEFORE DELETE ON chats BEGIN SELECT RAISE(ABORT, \
             'blocked'); END;",
         )
         .unwrap();
      assert!(repository.delete_chat("chat").is_err());
      let loaded = repository.load_chat("chat").unwrap();
      assert_eq!(loaded.messages.len(), 1);
      assert_eq!(loaded.tool_calls.len(), 1);
      assert_eq!(
         repository.load_checkpoints("chat").unwrap().as_deref(),
         Some("snapshot")
      );
   }

   fn call_rows(repository: &ChatHistoryRepository) -> Vec<(i64, String, String, i64)> {
      let conn = repository.open_connection().unwrap();
      let mut stmt = conn
         .prepare(
            "SELECT id, message_id, call_id, position FROM tool_calls ORDER BY message_id, \
             position",
         )
         .unwrap();
      stmt
         .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
         })
         .unwrap()
         .collect::<SqliteResult<Vec<_>>>()
         .unwrap()
   }

   fn loaded_call_ids(repository: &ChatHistoryRepository, chat_id: &str) -> Vec<String> {
      repository
         .load_chat(chat_id)
         .unwrap()
         .tool_calls
         .into_iter()
         .map(|call| call.call_id)
         .collect()
   }

   fn row_id_of(repository: &ChatHistoryRepository, call_id: &str) -> i64 {
      call_rows(repository)
         .into_iter()
         .find(|(_, _, id, _)| id == call_id)
         .map(|(row_id, ..)| row_id)
         .unwrap()
   }

   #[test]
   fn migrates_old_tool_call_rows_with_and_without_meta_ids() {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("history.db");
      let conn = Connection::open(&path).unwrap();
      conn
         .execute_batch(
            "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT \
             NULL, last_message_at INTEGER NOT NULL);
             CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT \
             NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL, is_streaming BOOLEAN, \
             is_tool_use BOOLEAN, tool_name TEXT);
             CREATE TABLE tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT \
             NULL, name TEXT NOT NULL, input TEXT, output TEXT, error TEXT, timestamp INTEGER NOT \
             NULL, is_complete BOOLEAN DEFAULT 0, meta TEXT);
             INSERT INTO chats VALUES ('chat', 'Chat', 1, 2);
             INSERT INTO messages VALUES ('one', 'chat', 'assistant', '', 1, 0, 1, NULL);
             INSERT INTO messages VALUES ('two', 'chat', 'assistant', '', 2, 0, 1, NULL);
             INSERT INTO tool_calls (message_id, name, timestamp, meta) VALUES
                ('one', 'read', 1, '{\"id\":\"toolu_a\",\"kind\":\"read\"}'),
                ('one', 'terminal', 1, NULL),
                ('one', 'read', 1, '{\"id\":\"toolu_a\"}'),
                ('one', 'edit', 1, '{not json'),
                ('two', 'read', 2, '{\"kind\":\"read\"}');",
         )
         .unwrap();
      drop(conn);

      let repository = ChatHistoryRepository::new(path);
      repository.initialize().unwrap();
      let migrated = call_rows(&repository);
      assert_eq!(
         migrated
            .iter()
            .map(|(_, message_id, call_id, position)| (
               message_id.as_str(),
               call_id.as_str(),
               *position
            ))
            .collect::<Vec<_>>(),
         vec![
            ("one", "toolu_a", 0),
            ("one", "one:tool-1", 1),
            ("one", "toolu_a#2", 2),
            ("one", "one:tool-3", 3),
            ("two", "two:tool-0", 0),
         ]
      );
      assert_eq!(
         loaded_call_ids(&repository, "chat"),
         vec![
            "toolu_a",
            "one:tool-1",
            "toolu_a#2",
            "one:tool-3",
            "two:tool-0"
         ]
      );

      repository.initialize().unwrap();
      assert_eq!(call_rows(&repository), migrated);

      // A row written by an older build after the migration is keyed on the next start.
      let conn = repository.open_connection().unwrap();
      conn
         .execute(
            "INSERT INTO tool_calls (message_id, name, timestamp, meta) VALUES ('one', 'late', 3, \
             '{\"id\":\"toolu_a\"}')",
            [],
         )
         .unwrap();
      drop(conn);
      repository.initialize().unwrap();
      let rows = call_rows(&repository);
      assert_eq!(&rows[..4], &migrated[..4]);
      assert_eq!((rows[4].2.as_str(), rows[4].3), ("toolu_a#3", 4));

      let conn = repository.open_connection().unwrap();
      let duplicate = conn.execute(
         "UPDATE tool_calls SET call_id = 'toolu_a' WHERE call_id = 'one:tool-1'",
         [],
      );
      assert!(duplicate.is_err());
   }

   fn tool_call_index_names(repository: &ChatHistoryRepository) -> Vec<String> {
      let conn = repository.open_connection().unwrap();
      let mut statement = conn
         .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tool_calls' AND \
             name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
         )
         .unwrap();
      statement
         .query_map([], |row| row.get::<_, String>(0))
         .unwrap()
         .collect::<SqliteResult<Vec<_>>>()
         .unwrap()
   }

   #[test]
   fn drops_the_redundant_tool_call_message_index() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      assert_eq!(
         tool_call_index_names(&repository),
         vec!["idx_tool_calls_message_call"]
      );

      // A database created by an older build still has the single-column index.
      repository
         .open_connection()
         .unwrap()
         .execute(
            "CREATE INDEX idx_tool_calls_message_id ON tool_calls(message_id)",
            [],
         )
         .unwrap();
      repository.initialize().unwrap();
      assert_eq!(
         tool_call_index_names(&repository),
         vec!["idx_tool_calls_message_call"]
      );
   }

   #[test]
   fn keeps_tool_call_rows_matched_by_id_across_reorder_insert_and_remove() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      let message = sample_message("chat", "reply");
      let call = |id: &str| sample_tool_call("reply", id);
      repository
         .save_chat(
            sample_chat("chat"),
            vec![message.clone()],
            vec![call("a"), call("b"), call("c")],
         )
         .unwrap();
      let (row_a, row_c) = (row_id_of(&repository, "a"), row_id_of(&repository, "c"));

      let conn = repository.open_connection().unwrap();
      conn
         .execute_batch(
            "CREATE TABLE writes (call_id TEXT);
             CREATE TRIGGER count_tool_call_writes AFTER UPDATE ON tool_calls BEGIN
                INSERT INTO writes VALUES (new.call_id);
             END;",
         )
         .unwrap();

      let mut finished = call("a");
      finished.output = Some("done".to_string());
      repository
         .save_chat(
            sample_chat("chat"),
            vec![message.clone()],
            vec![call("c"), call("x"), finished],
         )
         .unwrap();

      assert_eq!(loaded_call_ids(&repository, "chat"), vec!["c", "x", "a"]);
      assert_eq!(row_id_of(&repository, "a"), row_a);
      assert_eq!(row_id_of(&repository, "c"), row_c);
      let loaded = repository.load_chat("chat").unwrap();
      assert_eq!(loaded.tool_calls[2].output.as_deref(), Some("done"));
      assert_eq!(repository.get_stats().unwrap().total_tool_calls, 3);

      conn.execute("DELETE FROM writes", []).unwrap();
      repository
         .save_chat(
            sample_chat("chat"),
            vec![message],
            loaded.tool_calls.clone(),
         )
         .unwrap();
      let writes: i64 = conn
         .query_row("SELECT COUNT(*) FROM writes", [], |row| row.get(0))
         .unwrap();
      assert_eq!(writes, 0);
   }

   #[test]
   fn keys_repeated_and_missing_call_ids_the_same_way_on_every_save() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      let calls = vec![
         sample_tool_call("reply", "dup"),
         sample_tool_call("reply", "dup"),
         sample_tool_call("reply", ""),
      ];
      for _ in 0..2 {
         repository
            .save_chat(
               sample_chat("chat"),
               vec![sample_message("chat", "reply")],
               calls.clone(),
            )
            .unwrap();
      }
      assert_eq!(
         loaded_call_ids(&repository, "chat"),
         vec!["dup", "dup#2", "reply:tool-2"]
      );
      assert_eq!(repository.get_stats().unwrap().total_tool_calls, 3);
   }

   #[test]
   fn a_partial_save_rekeys_only_the_saved_messages_tool_calls() {
      let directory = tempfile::tempdir().unwrap();
      let repository = ChatHistoryRepository::new(directory.path().join("history.db"));
      repository.initialize().unwrap();
      let mut prompt = sample_message("chat", "prompt");
      prompt.timestamp = 1;
      repository
         .save_chat(
            sample_chat("chat"),
            vec![prompt, sample_message("chat", "reply")],
            vec![
               sample_tool_call("prompt", "p1"),
               sample_tool_call("reply", "r1"),
               sample_tool_call("reply", "r2"),
            ],
         )
         .unwrap();
      let (row_p1, row_r2) = (row_id_of(&repository, "p1"), row_id_of(&repository, "r2"));

      repository
         .save_chat_messages(
            sample_chat("chat"),
            vec![sample_message("chat", "reply")],
            vec![
               sample_tool_call("reply", "r2"),
               sample_tool_call("reply", "r3"),
            ],
         )
         .unwrap();

      assert_eq!(loaded_call_ids(&repository, "chat"), vec!["p1", "r2", "r3"]);
      assert_eq!(row_id_of(&repository, "p1"), row_p1);
      assert_eq!(row_id_of(&repository, "r2"), row_r2);
      let rows = call_rows(&repository);
      assert_eq!(
         rows
            .iter()
            .map(|(_, message_id, call_id, position)| (
               message_id.as_str(),
               call_id.as_str(),
               *position
            ))
            .collect::<Vec<_>>(),
         vec![("prompt", "p1", 0), ("reply", "r2", 0), ("reply", "r3", 1)]
      );
   }

   #[test]
   fn initializes_the_same_old_database_from_several_windows_at_once() {
      for _ in 0..20 {
         let directory = tempfile::tempdir().unwrap();
         let path = directory.path().join("history.db");
         Connection::open(&path)
            .unwrap()
            .execute_batch(
               "CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT \
                NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL, is_streaming BOOLEAN, \
                is_tool_use BOOLEAN, tool_name TEXT);
                CREATE TABLE tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT \
                NULL, name TEXT NOT NULL, input TEXT, output TEXT, error TEXT, timestamp INTEGER \
                NOT NULL, is_complete BOOLEAN DEFAULT 0, meta TEXT);
                INSERT INTO tool_calls (message_id, name, timestamp, meta) VALUES ('m', 'read', 1, \
                '{\"id\":\"toolu_1\"}');",
            )
            .unwrap();
         let start = std::sync::Arc::new(std::sync::Barrier::new(8));
         let results = (0..8)
            .map(|_| {
               let (path, start) = (path.clone(), start.clone());
               std::thread::spawn(move || {
                  start.wait();
                  ChatHistoryRepository::new(path).initialize()
               })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
         assert!(results.iter().all(Result::is_ok), "{results:?}");
         let repository = ChatHistoryRepository::new(path);
         assert_eq!(
            call_rows(&repository)
               .into_iter()
               .map(|(_, _, call_id, position)| (call_id, position))
               .collect::<Vec<_>>(),
            vec![("toolu_1".to_string(), 0)]
         );
      }
   }
}
