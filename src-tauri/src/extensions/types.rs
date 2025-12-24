use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionMetadata {
   pub id: String,
   pub name: String,
   pub version: String,
   pub installed_at: String,
   pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
   pub url: String,
   pub checksum: String,
   pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
   pub extension_id: String,
   pub status: InstallStatus,
   pub progress: f32, // 0.0 to 1.0
   pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InstallStatus {
   Downloading,
   Extracting,
   Verifying,
   Installing,
   Completed,
   Failed { error: String },
}
