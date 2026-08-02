use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexIntegrationStatus {
   pub installed: bool,
   pub version: Option<String>,
   pub running: bool,
   pub initialized: bool,
   pub state: String,
   pub error: Option<String>,
   pub cwd: Option<String>,
   pub thread_id: Option<String>,
   pub turn_id: Option<String>,
   pub account: Option<Value>,
}

impl Default for CodexIntegrationStatus {
   fn default() -> Self {
      Self {
         installed: false,
         version: None,
         running: false,
         initialized: false,
         state: "unavailable".to_string(),
         error: None,
         cwd: None,
         thread_id: None,
         turn_id: None,
         account: None,
      }
   }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProtocolEvent {
   pub method: String,
   pub params: Value,
   #[serde(skip_serializing_if = "Option::is_none")]
   pub id: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRequestDecision {
   pub request_id: Value,
   pub decision: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadSettings {
   pub model: Option<String>,
   pub effort: Option<String>,
   pub personality: Option<String>,
   pub approval_policy: Option<String>,
   pub sandbox: Option<String>,
   pub developer_instructions: Option<String>,
   pub service_tier: Option<String>,
   pub collaboration_mode: Option<String>,
}
