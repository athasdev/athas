use crate::terminal::shell::Shell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
   pub working_directory: Option<String>,
   pub shell: Option<Shell>,
   pub environment: Option<HashMap<String, String>>,
   pub command: Option<String>,
   pub args: Option<Vec<String>>,
   pub rows: u16,
   pub cols: u16,
}
