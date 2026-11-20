//! `database.*` and `docker.*`: the web workbench's database and Docker views, answered here with
//! the desktop's own engines (`database_view::relay::Host`, `docker_view::relay::Host`). Saved
//! connections and their passwords stay on this machine; the browser gets connection strings with
//! their passwords hidden. Docker runs this machine's `docker` CLI, and the host paths it is given
//! must be inside the workspace.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use database_view::relay::{DatabaseCall, Host as DatabaseHost};
use docker_view::relay::{DockerCall, Host as DockerHost};
use serde_json::{Map, Value};
use web_protocol::CallError;

use crate::Workspace;

#[derive(Default)]
pub(crate) struct Services {
    databases: RwLock<Arc<DatabaseHost>>,
    docker: DockerHost,
}

impl Services {
    pub(crate) fn set_database_paths(&self, connections: Option<PathBuf>, history: Option<PathBuf>) {
        *self.databases.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = Arc::new(DatabaseHost::new(connections, history));
    }

    pub(crate) fn set_docker_program(&self, program: OsString) {
        self.docker.set_program(program);
    }

    fn databases(&self) -> Arc<DatabaseHost> {
        self.databases.read().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }
}

pub(crate) fn database(workspace: &Workspace, method: &str, params: &Map<String, Value>) -> Result<Value, CallError> {
    let call = DatabaseCall::from_method(method, params).map_err(CallError::invalid)?;
    workspace.services.databases().call(call).map_err(|error| CallError::new("database_failed", error))
}

pub(crate) fn docker(workspace: &Workspace, method: &str, params: &Map<String, Value>) -> Result<Value, CallError> {
    let call = DockerCall::from_method(method, params).map_err(CallError::invalid)?;
    if let Some(path) = call.host_paths().into_iter().find(|path| !Path::new(path).starts_with(&workspace.root)) {
        return Err(CallError::invalid(format!("{path} is outside the workspace.")));
    }
    workspace.services.docker.call(call).map_err(|error| CallError::new("docker_failed", error))
}
