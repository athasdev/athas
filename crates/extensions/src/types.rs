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

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   #[test]
   fn install_progress_uses_the_tagged_shape_the_frontend_reads() {
      let progress = InstallProgress {
         extension_id: "language.rust".to_string(),
         status: InstallStatus::Verifying,
         progress: 0.5,
         message: "Verifying checksum...".to_string(),
      };
      assert_eq!(
         serde_json::to_value(&progress).unwrap(),
         json!({
            "extension_id": "language.rust",
            "status": { "type": "verifying" },
            "progress": 0.5,
            "message": "Verifying checksum..."
         })
      );

      let failed = InstallStatus::Failed {
         error: "Checksum mismatch".to_string(),
      };
      assert_eq!(
         serde_json::to_value(&failed).unwrap(),
         json!({ "type": "failed", "error": "Checksum mismatch" })
      );
   }

   #[test]
   fn download_info_and_metadata_round_trip() {
      let info: DownloadInfo = serde_json::from_value(json!({
         "url": "https://example.invalid/a.tar.gz",
         "checksum": "abc",
         "size": 42
      }))
      .unwrap();
      assert_eq!(info.size, 42);

      let metadata = ExtensionMetadata {
         id: "theme.one".to_string(),
         name: "Theme One".to_string(),
         version: "1.2.3".to_string(),
         installed_at: "2026-01-01T00:00:00Z".to_string(),
         enabled: false,
      };
      let decoded: ExtensionMetadata =
         serde_json::from_str(&serde_json::to_string(&metadata).unwrap()).unwrap();
      assert_eq!(decoded.id, metadata.id);
      assert_eq!(decoded.version, metadata.version);
      assert!(!decoded.enabled);
   }
}
