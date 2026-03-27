use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeSessionInfo {
   pub path: String,
   pub id: String,
   pub cwd: String,
   pub name: Option<String>,
   pub parent_session_path: Option<String>,
   pub created_at: String,
   pub modified_at: String,
   pub message_count: usize,
   pub first_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeTranscriptMessage {
   pub id: String,
   pub role: String,
   pub content: String,
   pub timestamp: String,
}
