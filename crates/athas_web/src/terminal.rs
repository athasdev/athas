//! Terminals on the server's PTY. Output and exits arrive on the socket ([`Events`]); input waits
//! there until the socket sends it, and size changes and closes go out without waiting.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Result, anyhow};
use serde_json::json;
use terminal_view::{Pty, PtyIo, PtySize};

use crate::{Events, Transport, failed, relative};

pub struct RemotePty {
    id: String,
    transport: Arc<dyn Transport>,
    events: Arc<Events>,
}

impl RemotePty {
    pub fn id(&self) -> &str {
        &self.id
    }
}

/// Starts a shell in `cwd` on the server.
pub fn spawn_terminal(
    root: &Path,
    transport: Arc<dyn Transport>,
    events: Arc<Events>,
    cwd: PathBuf,
    size: PtySize,
    io: PtyIo,
) -> Result<Box<dyn Pty>> {
    let cwd = relative(root, &cwd).unwrap_or_default();
    let created = transport.call("terminal.create", json!({ "cols": size.cols.max(1), "rows": size.rows.max(1), "cwd": cwd })).map_err(failed)?;
    let id = created["id"].as_str().ok_or_else(|| anyhow!("the server started no terminal"))?.to_string();
    events.add_terminal(id.clone(), io);
    Ok(Box::new(RemotePty { id, transport, events }))
}

impl Pty for RemotePty {
    fn resize(&self, size: PtySize) {
        self.transport.notify("terminal.resize", json!({ "id": self.id, "cols": size.cols.max(1), "rows": size.rows.max(1) }));
    }

    fn foreground_process_name(&self) -> Option<String> {
        None
    }
}

impl Drop for RemotePty {
    fn drop(&mut self) {
        self.events.remove_terminal(&self.id);
        self.transport.notify("terminal.close", json!({ "id": self.id }));
    }
}

/// Sends what was typed into the terminals and what agent sessions sent; the browser calls it
/// every frame or so.
pub fn send_input(transport: &dyn Transport, events: &Events) {
    for (id, message) in events.take_agent_messages() {
        transport.notify("agent.send", json!({ "id": id, "message": message }));
    }
    for (id, bytes) in events.take_input() {
        let params = match String::from_utf8(bytes) {
            Ok(data) => json!({ "id": id, "data": data }),
            Err(error) => json!({ "id": id, "bytes": web_protocol::to_base64(error.as_bytes()) }),
        };
        transport.notify("terminal.write", params);
    }
}
