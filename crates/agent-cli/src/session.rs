use crate::Options;
use anyhow::{Context, Result, bail};
use athas_ai::{ChatData, ChatHistoryRepository, MessageData, ToolCallData};
use std::{
   path::PathBuf,
   time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub fn now() -> i64 {
   SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis() as i64
}

pub struct Session {
   repository: ChatHistoryRepository,
   pub chat: ChatData,
   pub messages: Vec<MessageData>,
   tool_calls: Vec<ToolCallData>,
}

impl Session {
   pub fn open(options: &Options) -> Result<Self> {
      let path: PathBuf = if let Some(directory) = std::env::var_os("ATHAS_AGENT_DATA_DIR") {
         PathBuf::from(directory).join("chat_history.db")
      } else {
         dirs::data_dir()
            .context("Cannot locate application data directory")?
            .join(&options.app_identifier)
            .join("chat_history.db")
      };
      let repository = ChatHistoryRepository::new(path);
      repository.initialize().map_err(anyhow::Error::msg)?;
      let root = options.root.to_string_lossy();
      let previous = if let Some(id) = &options.session {
         Some(repository.load_chat(id).map_err(anyhow::Error::msg)?)
      } else if options.continue_last {
         let chat = repository
            .load_all_chats()
            .map_err(anyhow::Error::msg)?
            .into_iter()
            .filter(|chat| {
               chat.workspace_path.as_deref() == Some(root.as_ref())
                  && chat.session_settings.as_deref() == Some("{\"cli\":true}")
            })
            .max_by_key(|chat| chat.last_message_at);
         chat
            .map(|chat| repository.load_chat(&chat.id).map_err(anyhow::Error::msg))
            .transpose()?
      } else {
         None
      };
      if let Some(previous) = previous {
         if previous.chat.workspace_path.as_deref() != Some(root.as_ref()) {
            bail!("The selected session belongs to another workspace");
         }
         return Ok(Self {
            repository,
            chat: previous.chat,
            messages: previous.messages,
            tool_calls: previous.tool_calls,
         });
      }
      if options.model.is_empty() {
         bail!("No previous session found; select a model with --model");
      }
      let time = now();
      let session = Self {
         repository,
         chat: ChatData {
            id: Uuid::new_v4().to_string(),
            title: "New Agent session".into(),
            created_at: time,
            last_message_at: time,
            agent_id: Some("custom".into()),
            acp_session_id: None,
            workspace_path: Some(root.into_owned()),
            provider_id: Some(options.provider.clone()),
            model_id: Some(options.model.clone()),
            branch: None,
            is_pinned: false,
            archived_at: None,
            session_settings: Some("{\"cli\":true}".into()),
         },
         messages: Vec::new(),
         tool_calls: Vec::new(),
      };
      session
         .repository
         .save_chat(session.chat.clone(), Vec::new(), Vec::new())
         .map_err(anyhow::Error::msg)?;
      Ok(session)
   }

   pub fn add(&mut self, role: &str, content: String) -> Result<()> {
      let time = now();
      if self.messages.is_empty() && role == "user" {
         self.chat.title = content.chars().take(64).collect();
      }
      self.chat.last_message_at = time;
      self.messages.push(MessageData {
         id: Uuid::new_v4().to_string(),
         chat_id: self.chat.id.clone(),
         role: role.into(),
         content,
         timestamp: time,
         is_streaming: false,
         is_tool_use: false,
         tool_name: None,
         images: None,
         plan: None,
         stop_notice: None,
         turn_usage: None,
      });
      self
         .repository
         .save_chat(
            self.chat.clone(),
            self.messages.clone(),
            self.tool_calls.clone(),
         )
         .map_err(anyhow::Error::msg)
   }

   pub fn list(&self, root: &str) -> Result<Vec<ChatData>> {
      let mut chats = self
         .repository
         .load_all_chats()
         .map_err(anyhow::Error::msg)?
         .into_iter()
         .filter(|chat| chat.workspace_path.as_deref() == Some(root))
         .collect::<Vec<_>>();
      chats.sort_by_key(|chat| std::cmp::Reverse(chat.last_message_at));
      chats.truncate(12);
      Ok(chats)
   }

   pub fn update_connection(&mut self, provider: String, model: String) -> Result<()> {
      self.chat.provider_id = Some(provider);
      self.chat.model_id = Some(model);
      self
         .repository
         .save_chat(
            self.chat.clone(),
            self.messages.clone(),
            self.tool_calls.clone(),
         )
         .map_err(anyhow::Error::msg)
   }
}
