//! Files crossing between the browser and the workspace server (`transfer.*`): a file chosen in
//! the browser is uploaded into a transfer folder on the server, and a file the server put in
//! one comes back for a download.

use std::path::{Path, PathBuf};

use serde_json::json;
use web_protocol::{from_base64, to_base64};

use crate::Transport;

/// Uploads a chosen file; answers with its path on the server.
pub fn upload(transport: &dyn Transport, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let answer = transport.call("transfer.upload", json!({ "name": name, "content": to_base64(bytes) })).map_err(|error| error.message)?;
    answer["path"].as_str().map(PathBuf::from).ok_or_else(|| "The workspace server did not say where the file went.".to_string())
}

/// A new empty transfer folder on the server.
pub fn new_dir(transport: &dyn Transport) -> Result<PathBuf, String> {
    let answer = transport.call("transfer.dir", json!({})).map_err(|error| error.message)?;
    answer["path"].as_str().map(PathBuf::from).ok_or_else(|| "The workspace server made no transfer folder.".to_string())
}

/// A file of a transfer folder: its name and bytes.
pub fn read(transport: &dyn Transport, path: &Path) -> Result<(String, Vec<u8>), String> {
    let answer = transport.call("transfer.read", json!({ "path": path.to_string_lossy() })).map_err(|error| error.message)?;
    let bytes = from_base64(&answer["content"]).map_err(|error| error.message)?;
    Ok((answer["name"].as_str().unwrap_or("download").to_string(), bytes))
}
