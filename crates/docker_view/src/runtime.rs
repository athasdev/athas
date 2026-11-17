//! The bridge between GPUI and the Docker crate, whose futures need a tokio reactor (child
//! processes). One small runtime runs on its own threads; GPUI awaits its join handles. On the web
//! the workspace server runs the CLI (`relay`) and logs are polled from it.

#[cfg(not(target_family = "wasm"))]
use std::{
    sync::{Arc, OnceLock},
    time::Duration,
};
use std::{ffi::OsString, future::Future};

#[cfg(not(target_family = "wasm"))]
use athas_docker::{Docker, DockerLogEvent, DockerLogExitEvent, DockerLogSink, DockerLogStreams};
use futures::channel::mpsc::{UnboundedReceiver, UnboundedSender, unbounded};

#[cfg(target_family = "wasm")]
use crate::relay::{DockerCall, call_value};

#[cfg(not(target_family = "wasm"))]
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("athas-docker")
            .enable_all()
            .build()
            .expect("the Docker runtime starts")
    })
}

/// Runs `future` on the Docker runtime; the result can be awaited from any executor.
#[cfg(not(target_family = "wasm"))]
pub fn spawn<T: Send + 'static>(
    future: impl Future<Output = Result<T, String>> + Send + 'static,
) -> impl Future<Output = Result<T, String>> + Send + 'static {
    let handle = runtime().spawn(future);
    async move { handle.await.unwrap_or_else(|error| Err(format!("Docker task failed: {error}"))) }
}

/// The web's calls answer when they are made, so there is nothing to hand off.
#[cfg(target_family = "wasm")]
pub fn spawn<T: Send + 'static>(
    future: impl Future<Output = Result<T, String>> + Send + 'static,
) -> impl Future<Output = Result<T, String>> + Send + 'static {
    future
}

/// Runs `docker <args>` for what the crate has no call for (inspect, `volume rm`).
#[cfg(not(target_family = "wasm"))]
pub async fn run_cli(program: OsString, args: Vec<String>) -> Result<String, String> {
    let output = tokio::process::Command::new(program).args(&args).kill_on_drop(true).output();
    let output = tokio::time::timeout(Duration::from_secs(60), output)
        .await
        .map_err(|_| format!("docker {} timed out", args.join(" ")))?
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => "Docker CLI was not found.".to_string(),
            _ => format!("Failed to launch Docker CLI: {error}"),
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { format!("docker {} failed with {}", args.join(" "), output.status) } else { stderr });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_family = "wasm")]
pub async fn run_cli(_program: OsString, args: Vec<String>) -> Result<String, String> {
    serde_json::from_value(call_value(DockerCall::Cli { args })?).map_err(|error| error.to_string())
}

/// What `docker <kind> inspect <id>` printed, pretty-printed.
pub async fn inspect(program: OsString, kind: &'static str, id: String) -> Result<String, String> {
    run_cli(program, vec![kind.to_string(), "inspect".to_string(), id]).await.map(|text| pretty_json(&text))
}

/// Re-indents JSON with two spaces; anything that is not JSON comes back unchanged.
pub fn pretty_json(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| serde_json::to_string_pretty(&value).ok())
        .unwrap_or_else(|| text.trim_end().to_string())
}

/// A line or the end of a followed log.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LogMessage {
    Line { stderr: bool, text: String },
    Exit { code: Option<i32>, error: Option<String> },
}

#[cfg(not(target_family = "wasm"))]
struct ChannelSink(UnboundedSender<LogMessage>);

#[cfg(not(target_family = "wasm"))]
impl DockerLogSink for ChannelSink {
    fn line(&self, event: DockerLogEvent) {
        self.0.unbounded_send(LogMessage::Line { stderr: event.stream == "stderr", text: event.line }).ok();
    }

    fn exit(&self, event: DockerLogExitEvent) {
        self.0.unbounded_send(LogMessage::Exit { code: event.code, error: event.error }).ok();
    }
}

/// A running `docker logs --follow`. Dropping it stops the stream (and the child process).
#[cfg(not(target_family = "wasm"))]
pub struct LogStream {
    streams: Arc<DockerLogStreams>,
    started: Option<tokio::task::JoinHandle<Option<String>>>,
}

#[cfg(not(target_family = "wasm"))]
impl LogStream {
    /// Follows `container_id`, starting `tail` lines back; its lines arrive on the receiver.
    pub fn start(program: OsString, container_id: String, tail: u16) -> (Self, UnboundedReceiver<LogMessage>) {
        let (sender, receiver) = unbounded();
        let streams = Arc::new(DockerLogStreams::default());
        let task_streams = streams.clone();
        let started = runtime().spawn(async move {
            let sink = Arc::new(ChannelSink(sender.clone()));
            match task_streams.start(Docker::with_program(program), container_id, Some(tail), sink).await {
                Ok(id) => Some(id),
                Err(error) => {
                    sender.unbounded_send(LogMessage::Exit { code: None, error: Some(error) }).ok();
                    None
                }
            }
        });
        (Self { streams, started: Some(started) }, receiver)
    }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for LogStream {
    fn drop(&mut self) {
        let streams = self.streams.clone();
        let Some(started) = self.started.take() else { return };
        // Waits for the start, so a stream dropped while starting still stops.
        runtime().spawn(async move {
            if let Ok(Some(id)) = started.await {
                streams.stop(&id).await;
            }
        });
    }
}

/// A log the workspace server follows; [`LogStream::poll`] brings what it read since.
#[cfg(target_family = "wasm")]
pub struct LogStream {
    stream: Option<String>,
    sender: UnboundedSender<LogMessage>,
}

#[cfg(target_family = "wasm")]
impl LogStream {
    pub fn start(_program: OsString, container_id: String, tail: u16) -> (Self, UnboundedReceiver<LogMessage>) {
        let (sender, receiver) = unbounded();
        let stream = match call_value(DockerCall::LogsStart { container_id, tail }) {
            Ok(serde_json::Value::String(stream)) => Some(stream),
            Ok(_) => None,
            Err(error) => {
                sender.unbounded_send(LogMessage::Exit { code: None, error: Some(error) }).ok();
                None
            }
        };
        (Self { stream, sender }, receiver)
    }

    /// Sends what the server read since the last poll to the receiver; false once the log ended.
    pub fn poll(&self) -> bool {
        let Some(stream) = self.stream.clone() else { return false };
        let messages = call_value(DockerCall::LogsRead { stream })
            .and_then(|value| serde_json::from_value::<Vec<LogMessage>>(value).map_err(|error| error.to_string()));
        match messages {
            Ok(messages) => {
                let ended = messages.iter().any(|message| matches!(message, LogMessage::Exit { .. }));
                for message in messages {
                    self.sender.unbounded_send(message).ok();
                }
                !ended
            }
            Err(error) => {
                self.sender.unbounded_send(LogMessage::Exit { code: None, error: Some(error) }).ok();
                false
            }
        }
    }
}

#[cfg(target_family = "wasm")]
impl Drop for LogStream {
    fn drop(&mut self) {
        if let Some(stream) = self.stream.take() {
            call_value(DockerCall::LogsStop { stream }).ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_prints_json() {
        assert_eq!(pretty_json(r#"[{"Id":"abc","State":{"Running":true}}]"#).lines().count(), 8);
        assert_eq!(pretty_json("not json\n"), "not json");
    }

    #[test]
    fn bridges_results_back() {
        let result = futures::executor::block_on(spawn(async { Ok::<_, String>(21 * 2) }));
        assert_eq!(result, Ok(42));
    }

    #[cfg(unix)]
    fn fake_docker() -> OsString {
        concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/fake-docker").into()
    }

    #[cfg(unix)]
    #[test]
    fn reads_the_fixture_inventory_through_the_crate() {
        let docker = Docker::with_program(fake_docker());
        let inventory = futures::executor::block_on(spawn(async move { docker.inventory().await })).unwrap();
        assert_eq!(inventory.containers.len(), 4);
        assert_eq!(inventory.containers[0].health.as_deref(), Some("healthy"));
        assert_eq!(inventory.images.len(), 5);
        assert_eq!(inventory.volumes.len(), 3);

        let refused = futures::executor::block_on(spawn(run_cli(fake_docker(), vec!["rm".into(), "x".into()])));
        assert!(refused.unwrap_err().contains("refusing"));
    }

    #[cfg(unix)]
    #[test]
    fn inspects_as_pretty_json() {
        let text = futures::executor::block_on(spawn(inspect(fake_docker(), "container", "web".into()))).unwrap();
        assert!(text.starts_with("[\n  {\n"));
        assert!(text.contains("\"Running\": true"));
    }

    #[cfg(unix)]
    #[test]
    fn follows_logs_until_dropped() {
        use futures::StreamExt;
        let (stream, receiver) = LogStream::start(fake_docker(), "web".into(), 100);
        let lines: Vec<LogMessage> = futures::executor::block_on(receiver.take(13).collect());
        drop(stream);
        assert!(matches!(&lines[0], LogMessage::Line { stderr: false, text } if text.ends_with("request 1")));
        assert!(lines.iter().any(|line| matches!(line, LogMessage::Line { stderr: true, .. })));
    }
}
