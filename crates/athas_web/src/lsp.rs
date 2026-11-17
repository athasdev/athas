//! Language servers on the workspace server: `lsp.start` runs one there, the editor's messages go
//! out with `lsp.send`, and what the server writes comes back on the socket ([`Events`]).

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use lsp_client::{EventSink, LanguageServer, Launcher, OpenError, ServerEntry, ServerId};
use serde_json::json;

use crate::{Events, Transport, relative};

pub struct RemoteLauncher {
    root: PathBuf,
    transport: Arc<dyn Transport>,
    events: Arc<Events>,
}

impl RemoteLauncher {
    pub fn new(root: PathBuf, transport: Arc<dyn Transport>, events: Arc<Events>) -> Self {
        Self { root, transport, events }
    }
}

/// The server's end of a language server; dropping it (the client shut the server down, or lost
/// it) stops the process.
struct RemoteServer {
    id: String,
    transport: Arc<dyn Transport>,
}

impl Drop for RemoteServer {
    fn drop(&mut self) {
        self.transport.notify("lsp.stop", json!({ "id": self.id }));
    }
}

impl Launcher for RemoteLauncher {
    fn launch(&self, id: ServerId, name: &str, entry: &ServerEntry, root: &Path, events: EventSink) -> Result<Arc<LanguageServer>, OpenError> {
        let cwd = relative(&self.root, root).unwrap_or_default();
        let started = self
            .transport
            .call("lsp.start", json!({ "command": entry.command, "args": entry.args, "cwd": cwd }))
            .map_err(|error| match error.code.as_str() {
                "not_installed" => OpenError::NotInstalled { server: name.to_string() },
                _ => OpenError::Failed { server: name.to_string(), message: error.message },
            })?;
        let remote_id = started["id"].as_str().ok_or_else(|| OpenError::Failed { server: name.to_string(), message: "the server started nothing".into() })?;
        let remote = RemoteServer { id: remote_id.to_string(), transport: self.transport.clone() };
        let write = Box::new(move |message: String| remote.transport.notify("lsp.send", json!({ "id": remote.id, "message": message })));
        let server = LanguageServer::connect_messages(id, name, root, entry.initialization_options.clone(), events, write);
        self.events.add_language_server(remote_id.to_string(), &server);
        Ok(server)
    }
}
