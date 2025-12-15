use serde::{Deserialize, Serialize};
use std::fmt;

/// Status of a runtime installation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeStatus {
   /// Runtime is not installed and not available
   NotInstalled,
   /// Runtime is available on system PATH
   SystemAvailable,
   /// Runtime was downloaded and managed by Athas
   ManagedInstalled,
   /// Runtime path is configured by user in settings
   CustomConfigured,
}

/// Source of the runtime binary
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum RuntimeSource {
   /// Found on system PATH
   System,
   /// Downloaded and managed by Athas
   Managed,
   /// User-configured custom path
   Custom,
}

/// Errors that can occur during runtime operations
#[derive(Debug)]
pub enum RuntimeError {
   /// Runtime not found on system PATH
   NotFound(String),
   /// Version is below minimum required
   VersionTooOld { found: String, minimum: String },
   /// Failed to check runtime version
   VersionCheckFailed(String),
   /// Download failed
   DownloadFailed(String),
   /// Extraction failed
   ExtractionFailed(String),
   /// IO error
   IoError(std::io::Error),
   /// Path error
   PathError(String),
   /// Other error
   Other(String),
}

impl fmt::Display for RuntimeError {
   fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      match self {
         RuntimeError::NotFound(name) => write!(f, "Runtime '{}' not found on system", name),
         RuntimeError::VersionTooOld { found, minimum } => {
            write!(
               f,
               "Runtime version {} is below minimum required {}",
               found, minimum
            )
         }
         RuntimeError::VersionCheckFailed(msg) => {
            write!(f, "Failed to check runtime version: {}", msg)
         }
         RuntimeError::DownloadFailed(msg) => write!(f, "Download failed: {}", msg),
         RuntimeError::ExtractionFailed(msg) => write!(f, "Extraction failed: {}", msg),
         RuntimeError::IoError(e) => write!(f, "IO error: {}", e),
         RuntimeError::PathError(msg) => write!(f, "Path error: {}", msg),
         RuntimeError::Other(msg) => write!(f, "{}", msg),
      }
   }
}

impl std::error::Error for RuntimeError {
}

impl From<std::io::Error> for RuntimeError {
   fn from(err: std::io::Error) -> Self {
      RuntimeError::IoError(err)
   }
}

impl From<RuntimeError> for String {
   fn from(err: RuntimeError) -> Self {
      err.to_string()
   }
}
