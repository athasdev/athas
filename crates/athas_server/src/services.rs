//! `docker.*`: the web workbench's Docker view, answered here with the desktop's own engine
//! (`docker_view::relay::Host`). Docker runs this machine's `docker` CLI, and the host paths it is
//! given must be inside the workspace.

use std::{ffi::OsString, path::Path};

use docker_view::relay::{DockerCall, Host as DockerHost};
use serde_json::{Map, Value};
use web_protocol::CallError;

use crate::Workspace;

#[derive(Default)]
pub(crate) struct Services {
    docker: DockerHost,
}

impl Services {
    pub(crate) fn set_docker_program(&self, program: OsString) {
        self.docker.set_program(program);
    }
}

pub(crate) fn docker(workspace: &Workspace, method: &str, params: &Map<String, Value>) -> Result<Value, CallError> {
    let call = DockerCall::from_method(method, params).map_err(CallError::invalid)?;
    if let Some(path) = call.host_paths().into_iter().find(|path| !Path::new(path).starts_with(&workspace.root)) {
        return Err(CallError::invalid(format!("{path} is outside the workspace.")));
    }
    workspace.services.docker.call(call).map_err(|error| CallError::new("docker_failed", error))
}
