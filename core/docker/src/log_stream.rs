use crate::{Docker, DockerLogEvent, DockerLogExitEvent, process::format_docker_launch_error};
use std::{collections::HashMap, process::Stdio, sync::Arc};
use tokio::{
   io::{AsyncBufReadExt, AsyncRead, BufReader},
   sync::Mutex,
   task::JoinHandle,
};
use uuid::Uuid;

/// Receives the lines and the exit of a followed container log stream.
pub trait DockerLogSink: Send + Sync + 'static {
   fn line(&self, event: DockerLogEvent);
   fn exit(&self, event: DockerLogExitEvent);
}

type StreamTasks = Arc<Mutex<HashMap<String, JoinHandle<()>>>>;

/// Running `docker logs --follow` streams, keyed by stream id.
#[derive(Default)]
pub struct DockerLogStreams {
   tasks: StreamTasks,
}

impl DockerLogStreams {
   /// Follows the logs of `container_id`, starting `tail` lines back (300 by default), and
   /// returns the id that identifies the stream in its events.
   pub async fn start(
      &self,
      docker: Docker,
      container_id: String,
      tail: Option<u16>,
      sink: Arc<dyn DockerLogSink>,
   ) -> Result<String, String> {
      if container_id.trim().is_empty() {
         return Err("Container id is required.".to_string());
      }

      let stream_id = Uuid::new_v4().to_string();
      let stream = LogStream {
         docker,
         sink,
         tasks: self.tasks.clone(),
         stream_id: stream_id.clone(),
         container_id,
         tail: tail.unwrap_or(300).to_string(),
      };
      // Hold the lock while spawning so a stream that ends immediately cannot try to remove
      // itself before it has been inserted.
      let mut tasks = self.tasks.lock().await;
      tasks.insert(stream_id.clone(), tokio::spawn(stream.run()));
      Ok(stream_id)
   }

   /// Stops the stream; unknown or blank ids are ignored.
   pub async fn stop(&self, stream_id: &str) {
      if stream_id.trim().is_empty() {
         return;
      }

      if let Some(handle) = self.tasks.lock().await.remove(stream_id) {
         handle.abort();
      }
   }

   #[cfg(test)]
   pub(crate) async fn active_count(&self) -> usize {
      self.tasks.lock().await.len()
   }
}

struct LogStream {
   docker: Docker,
   sink: Arc<dyn DockerLogSink>,
   tasks: StreamTasks,
   stream_id: String,
   container_id: String,
   tail: String,
}

impl LogStream {
   async fn run(self) {
      let mut command = self.docker.command();
      command
         .args([
            "logs",
            "--follow",
            "--timestamps",
            "--tail",
            &self.tail,
            &self.container_id,
         ])
         .stdout(Stdio::piped())
         .stderr(Stdio::piped())
         .kill_on_drop(true);

      let mut child = match command.spawn() {
         Ok(child) => child,
         Err(error) => {
            self.emit_exit(None, Some(format_docker_launch_error(error)));
            self.tasks.lock().await.remove(&self.stream_id);
            return;
         }
      };

      let stdout_task = child
         .stdout
         .take()
         .map(|stdout| self.spawn_reader("stdout", stdout));
      let stderr_task = child
         .stderr
         .take()
         .map(|stderr| self.spawn_reader("stderr", stderr));

      let status = child.wait().await;
      // Drain what the readers already buffered before reporting the exit.
      for task in [stdout_task, stderr_task].into_iter().flatten() {
         let _ = task.await;
      }
      match status {
         Ok(status) => self.emit_exit(status.code(), None),
         Err(error) => self.emit_exit(None, Some(format!("Docker log stream failed: {}", error))),
      }

      self.tasks.lock().await.remove(&self.stream_id);
   }

   fn spawn_reader<R>(&self, stream: &'static str, reader: R) -> JoinHandle<()>
   where
      R: AsyncRead + Unpin + Send + 'static,
   {
      let sink = self.sink.clone();
      let stream_id = self.stream_id.clone();
      let container_id = self.container_id.clone();
      tokio::spawn(async move {
         let mut lines = BufReader::new(reader).lines();
         loop {
            let (stream, line, done) = match lines.next_line().await {
               Ok(Some(line)) => (stream, line, false),
               Ok(None) => break,
               Err(error) => (
                  "stderr",
                  format!("Failed to read Docker log stream: {}", error),
                  true,
               ),
            };
            sink.line(DockerLogEvent {
               stream_id: stream_id.clone(),
               container_id: container_id.clone(),
               stream: stream.to_string(),
               line,
            });
            if done {
               break;
            }
         }
      })
   }

   fn emit_exit(&self, code: Option<i32>, error: Option<String>) {
      self.sink.exit(DockerLogExitEvent {
         stream_id: self.stream_id.clone(),
         container_id: self.container_id.clone(),
         code,
         error,
      });
   }
}
