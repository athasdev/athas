use crate::protocol::TerminalSize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConfig {
   pub working_directory: Option<String>,
   pub shell: Option<String>,
   pub wsl_distribution: Option<String>,
   pub wsl_working_directory: Option<String>,
   pub environment: Option<HashMap<String, String>>,
   pub command: Option<String>,
   pub args: Option<Vec<String>>,
   pub size: TerminalSize,
   #[serde(default)]
   pub term_program_version: Option<String>,
}
