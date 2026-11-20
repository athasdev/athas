//! The Docker view of the web workbench. Each [`DockerCall`] is a method of the workspace protocol
//! (`docker.*`): in the browser the view's `Docker` sends them (`remote.rs`), and the workspace
//! server answers them with [`Host`], which drives its own `docker` CLI. Requests travel as the
//! crate's JSON, so each side reads them with its own types.

use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const METHOD_PREFIX: &str = "docker.";

/// One call of the Docker view, named `docker.<method>` on the wire.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DockerCall {
    Inventory,
    ContainerAction { container_id: String, action: String, force: Option<bool> },
    BuildImage { request: Value },
    RunImage { request: Value },
    ImageAction { image_id: String, action: String, force: Option<bool> },
    PruneResources { target: String, include_volumes: Option<bool> },
    ListContainerFiles { container_id: String, path: Option<String> },
    CopyFromContainer { container_id: String, container_path: String, host_path: String },
    CopyToContainer { container_id: String, host_path: String, container_path: String },
    RegistrySearch { query: String, limit: Option<u16> },
    RegistryLogin { request: Value },
    RegistryPull { image: String },
    RegistryPush { image: String },
    TagImage { source: String, target: String },
    ComposeProject { workspace_path: Option<String> },
    ComposeAction { workspace_path: String, files: Vec<String>, service: Option<String>, action: String, env_files: Option<Vec<String>> },
    OpenDevContainer { workspace_path: String, config_path: String },
    ProjectConfig { workspace_path: Option<String> },
    SaveProjectConfig { workspace_path: String, config: Value },
    OpenEnvFile { workspace_path: String, path: String },
    DeleteEnvFile { workspace_path: String, path: String },
    /// `docker <args>`, for what the crate has no call for (inspect, `volume rm`).
    Cli { args: Vec<String> },
    /// Follows a container's log; the answer names the stream `logsRead` drains.
    LogsStart { container_id: String, tail: u16 },
    LogsRead { stream: String },
    LogsStop { stream: String },
}

impl DockerCall {
    /// The protocol method and its parameters.
    pub fn to_method(&self) -> (String, Value) {
        let mut params = serde_json::to_value(self).unwrap_or_default();
        let method = params.as_object_mut().and_then(|fields| fields.remove("method")).and_then(|method| method.as_str().map(str::to_string)).unwrap_or_default();
        (format!("{METHOD_PREFIX}{method}"), params)
    }

    pub fn from_method(method: &str, params: &Map<String, Value>) -> Result<Self, String> {
        let name = method.strip_prefix(METHOD_PREFIX).ok_or_else(|| format!("{method} is not a Docker method."))?;
        let mut params = params.clone();
        params.insert("method".into(), Value::String(name.into()));
        serde_json::from_value(Value::Object(params)).map_err(|error| format!("Invalid {method} call: {error}"))
    }

    /// The paths on the server's machine the call reads or writes, which a server keeps inside
    /// its workspace.
    pub fn host_paths(&self) -> Vec<&str> {
        match self {
            DockerCall::CopyFromContainer { host_path, .. } | DockerCall::CopyToContainer { host_path, .. } => vec![host_path],
            DockerCall::ComposeProject { workspace_path } | DockerCall::ProjectConfig { workspace_path } => {
                workspace_path.as_deref().into_iter().collect()
            }
            DockerCall::ComposeAction { workspace_path, .. }
            | DockerCall::OpenDevContainer { workspace_path, .. }
            | DockerCall::SaveProjectConfig { workspace_path, .. }
            | DockerCall::OpenEnvFile { workspace_path, .. }
            | DockerCall::DeleteEnvFile { workspace_path, .. } => vec![workspace_path],
            _ => Vec::new(),
        }
    }
}

/// How the browser reaches the workspace server.
pub trait DockerTransport: Send + Sync {
    /// Runs one protocol method and waits for its answer.
    fn call(&self, method: &str, params: Value) -> Result<Value, String>;
}

static TRANSPORT: RwLock<Option<Arc<dyn DockerTransport>>> = RwLock::new(None);

/// Sends the Docker view's calls to the workspace server from now on.
pub fn set_transport(transport: Arc<dyn DockerTransport>) {
    *TRANSPORT.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(transport);
}

/// Runs `call` on the workspace server.
pub fn call_value(call: DockerCall) -> Result<Value, String> {
    let transport = TRANSPORT
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .ok_or_else(|| "Docker is not available without a workspace server.".to_string())?;
    let (method, params) = call.to_method();
    transport.call(&method, params)
}

#[cfg(not(target_family = "wasm"))]
pub use host::Host;

#[cfg(not(target_family = "wasm"))]
mod host {
    use std::{
        collections::BTreeMap,
        ffi::OsString,
        future::Future,
        sync::{Mutex, MutexGuard, RwLock},
    };

    use athas_docker::Docker;
    use futures::channel::mpsc::{TryRecvError, UnboundedReceiver};
    use serde::{Serialize, de::DeserializeOwned};
    use serde_json::Value;

    use super::DockerCall;
    use crate::runtime::{self, LogMessage, LogStream};

    /// Logs a client follows at once; following another stops the oldest.
    const MAX_LOGS: usize = 16;

    type Logs = (u64, BTreeMap<u64, (LogStream, UnboundedReceiver<LogMessage>)>);

    /// The workspace server's side: its `docker` CLI and the logs its clients follow.
    pub struct Host {
        program: RwLock<OsString>,
        logs: Mutex<Logs>,
    }

    impl Default for Host {
        fn default() -> Self {
            Self { program: RwLock::new(crate::model::default_program()), logs: Mutex::new((0, BTreeMap::new())) }
        }
    }

    fn wait<T: Serialize + Send + 'static>(future: impl Future<Output = Result<T, String>> + Send + 'static) -> Result<Value, String> {
        let value = futures::executor::block_on(runtime::spawn(future))?;
        serde_json::to_value(value).map_err(|error| error.to_string())
    }

    fn read<T: DeserializeOwned>(value: Value) -> Result<T, String> {
        serde_json::from_value(value).map_err(|error| format!("Invalid request: {error}"))
    }

    fn stream_id(stream: &str) -> Option<u64> {
        stream.strip_prefix("log").and_then(|id| id.parse().ok())
    }

    impl Host {
        /// Runs `program` in place of `docker`.
        pub fn set_program(&self, program: OsString) {
            *self.program.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = program;
        }

        fn program(&self) -> OsString {
            self.program.read().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
        }

        fn logs(&self) -> MutexGuard<'_, Logs> {
            self.logs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
        }

        pub fn call(&self, call: DockerCall) -> Result<Value, String> {
            use DockerCall::*;
            let docker = Docker::with_program(self.program());
            match call {
                Inventory => wait(async move { docker.inventory().await }),
                ContainerAction { container_id, action, force } => wait(async move { docker.container_action(container_id, action, force).await }),
                BuildImage { request } => {
                    let request = read(request)?;
                    wait(async move { docker.build_image(request).await })
                }
                RunImage { request } => {
                    let request = read(request)?;
                    wait(async move { docker.run_image(request).await })
                }
                ImageAction { image_id, action, force } => wait(async move { docker.image_action(image_id, action, force).await }),
                PruneResources { target, include_volumes } => wait(async move { docker.prune_resources(target, include_volumes).await }),
                ListContainerFiles { container_id, path } => wait(async move { docker.list_container_files(container_id, path).await }),
                CopyFromContainer { container_id, container_path, host_path } => {
                    wait(async move { docker.copy_from_container(container_id, container_path, host_path).await })
                }
                CopyToContainer { container_id, host_path, container_path } => {
                    wait(async move { docker.copy_to_container(container_id, host_path, container_path).await })
                }
                RegistrySearch { query, limit } => wait(async move { docker.registry_search(query, limit).await }),
                RegistryLogin { request } => {
                    let request = read(request)?;
                    wait(async move { docker.registry_login(request).await })
                }
                RegistryPull { image } => wait(async move { docker.registry_pull(image).await }),
                RegistryPush { image } => wait(async move { docker.registry_push(image).await }),
                TagImage { source, target } => wait(async move { docker.tag_image(source, target).await }),
                ComposeProject { workspace_path } => wait(async move { docker.compose_project(workspace_path).await }),
                ComposeAction { workspace_path, files, service, action, env_files } => {
                    wait(async move { docker.compose_action(workspace_path, files, service, action, env_files).await })
                }
                OpenDevContainer { workspace_path, config_path } => wait(async move { docker.open_dev_container(workspace_path, config_path).await }),
                ProjectConfig { workspace_path } => json(athas_docker::project_config(workspace_path)?),
                SaveProjectConfig { workspace_path, config } => json(athas_docker::save_project_config(workspace_path, read(config)?)?),
                OpenEnvFile { workspace_path, path } => json(athas_docker::open_env_file(workspace_path, path)?),
                DeleteEnvFile { workspace_path, path } => json(athas_docker::delete_env_file(workspace_path, path)?),
                Cli { args } => {
                    let program = self.program();
                    wait(async move { runtime::run_cli(program, args).await })
                }
                LogsStart { container_id, tail } => {
                    let started = LogStream::start(self.program(), container_id, tail);
                    let (id, oldest) = {
                        let mut logs = self.logs();
                        logs.0 += 1;
                        let id = logs.0;
                        logs.1.insert(id, started);
                        (id, if logs.1.len() > MAX_LOGS { logs.1.pop_first() } else { None })
                    };
                    drop(oldest);
                    json(format!("log{id}"))
                }
                LogsRead { stream } => {
                    let id = stream_id(&stream).ok_or_else(|| "The log is no longer followed.".to_string())?;
                    let mut logs = self.logs();
                    let Some((_, receiver)) = logs.1.get_mut(&id) else { return Err("The log is no longer followed.".into()) };
                    let mut messages = Vec::new();
                    let mut ended = false;
                    loop {
                        match receiver.try_recv() {
                            Ok(message) => {
                                ended |= matches!(message, LogMessage::Exit { .. });
                                messages.push(message);
                            }
                            Err(TryRecvError::Closed) => {
                                ended = true;
                                break;
                            }
                            Err(TryRecvError::Empty) => break,
                        }
                    }
                    if ended {
                        logs.1.remove(&id);
                    }
                    json(messages)
                }
                LogsStop { stream } => {
                    let stopped = stream_id(&stream).and_then(|id| self.logs().1.remove(&id));
                    drop(stopped);
                    json(())
                }
            }
        }
    }

    fn json(value: impl Serialize) -> Result<Value, String> {
        serde_json::to_value(value).map_err(|error| error.to_string())
    }
}
