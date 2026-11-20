//! The database and Docker views' relays: their calls go to the workspace server, which opens the
//! databases and runs the `docker` CLI there (`database.*`, `docker.*`).

use std::sync::Arc;

use serde_json::Value;

use crate::Transport;

pub struct ServiceRelay {
    transport: Arc<dyn Transport>,
}

impl ServiceRelay {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.transport.call(method, params).map_err(|error| error.message)
    }
}

impl database_view::relay::DatabaseTransport for ServiceRelay {
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        ServiceRelay::call(self, method, params)
    }
}

impl docker_view::relay::DockerTransport for ServiceRelay {
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        ServiceRelay::call(self, method, params)
    }
}

/// Where the workspace server serves `file` as an HTML preview: under the preview path it gave
/// (`preview.base`), which grants reading the workspace's files and nothing else.
pub fn preview_address(server: &str, preview_path: &str, root: &std::path::Path, file: &std::path::Path) -> Option<String> {
    let relative = crate::relative(root, file).ok()?;
    let encoded: Vec<String> = relative
        .split('/')
        .map(|segment| {
            segment
                .bytes()
                .map(|byte| match byte {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
                    _ => format!("%{byte:02X}"),
                })
                .collect()
        })
        .collect();
    Some(format!("{}{preview_path}{}", server.trim_end_matches('/'), encoded.join("/")))
}
