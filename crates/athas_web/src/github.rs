//! The GitHub views' relay: their calls go to the workspace server, which makes them with its own
//! token (`github.*`).

use std::sync::Arc;

use serde_json::Value;

use crate::Transport;

pub struct GitHubRelay {
    transport: Arc<dyn Transport>,
}

impl GitHubRelay {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }
}

impl github_panel::relay::GitHubTransport for GitHubRelay {
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.transport.call(method, params).map_err(|error| error.message)
    }
}
