use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspError {
   pub message: String,
}

impl From<anyhow::Error> for LspError {
   fn from(err: anyhow::Error) -> Self {
      Self {
         message: err.to_string(),
      }
   }
}

pub type LspResult<T> = Result<T, LspError>;
