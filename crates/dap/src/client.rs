//! A connection to one debug adapter: requests with their responses, and everything else the
//! adapter sends (events, its own requests, stderr) on a channel. Blocking I/O runs on threads, so
//! the client works from any executor.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context as _, Result, anyhow, bail};
use futures::channel::{mpsc::UnboundedReceiver, mpsc::UnboundedSender, mpsc::unbounded, oneshot};
use serde_json::{Value, json};

use crate::transport::{read_message, write_message};

/// What the adapter sent that is not a response to one of our requests.
#[derive(Clone, Debug, PartialEq)]
pub enum Incoming {
    Event { event: String, body: Value },
    /// A reverse request, such as `runInTerminal`; answer it with [`DapClient::respond`].
    Request { seq: i64, command: String, arguments: Value },
    /// A line the adapter process wrote to stderr (or stdout, for adapters that talk over TCP).
    Log(String),
    /// The connection ended; nothing follows.
    Closed(String),
}

/// How to start an adapter process.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AdapterCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<PathBuf>,
}

impl AdapterCommand {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args).envs(self.env.iter().map(|(key, value)| (key, value)));
        if let Some(cwd) = &self.cwd {
            command.current_dir(cwd);
        }
        // An adapter runs in the background; on Windows it must not open a console window.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
    }

    pub fn display(&self) -> String {
        std::iter::once(self.program.display().to_string()).chain(self.args.iter().cloned()).collect::<Vec<_>>().join(" ")
    }
}

/// Requests waiting for their response, and why the connection closed once it has.
#[derive(Default)]
struct PendingState {
    waiters: HashMap<i64, oneshot::Sender<Result<Value>>>,
    closed: Option<String>,
}

type Pending = Arc<Mutex<PendingState>>;

pub struct DapClient {
    writer: mpsc::Sender<Value>,
    next_seq: AtomicI64,
    pending: Pending,
    process: Option<Arc<Mutex<Child>>>,
    socket: Option<TcpStream>,
}

impl DapClient {
    /// Starts an adapter that speaks DAP on its stdin and stdout.
    pub fn spawn(adapter: &AdapterCommand) -> Result<(Self, UnboundedReceiver<Incoming>)> {
        let mut child = adapter
            .command()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("could not start the debug adapter `{}`", adapter.display()))?;
        let stdin = child.stdin.take().context("adapter stdin")?;
        let stdout = child.stdout.take().context("adapter stdout")?;
        let stderr = child.stderr.take().context("adapter stderr")?;
        let process = Arc::new(Mutex::new(child));
        let (mut client, incoming_tx, incoming) = Self::from_streams(stdout, stdin, Some(process.clone()));
        forward_lines(stderr, incoming_tx);
        client.process = Some(process);
        Ok((client, incoming))
    }

    /// Starts an adapter that listens on a TCP port (when `adapter` is given), then connects to
    /// it, retrying until `timeout` while the adapter comes up.
    pub fn connect(
        host: &str,
        port: u16,
        adapter: Option<&AdapterCommand>,
        timeout: Duration,
    ) -> Result<(Self, UnboundedReceiver<Incoming>)> {
        let mut child = match adapter {
            Some(adapter) => Some(
                adapter
                    .command()
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .with_context(|| format!("could not start the debug adapter `{}`", adapter.display()))?,
            ),
            None => None,
        };
        let started = Instant::now();
        let socket = loop {
            match TcpStream::connect((host, port)) {
                Ok(socket) => break socket,
                Err(error) => {
                    if let Some(child) = child.as_mut()
                        && let Ok(Some(status)) = child.try_wait()
                    {
                        let mut stderr = String::new();
                        if let Some(mut pipe) = child.stderr.take() {
                            pipe.read_to_string(&mut stderr).ok();
                        }
                        bail!("the debug adapter exited ({status}) before accepting a connection. {}", stderr.trim());
                    }
                    if started.elapsed() > timeout {
                        if let Some(child) = child.as_mut() {
                            child.kill().ok();
                            child.wait().ok();
                        }
                        return Err(anyhow!(error).context(format!("could not connect to the debug adapter at {host}:{port}")));
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }
        };
        socket.set_nodelay(true).ok();
        let reader = socket.try_clone()?;
        let writer = socket.try_clone()?;
        let (mut client, incoming_tx, incoming) = Self::from_streams(reader, writer, None);
        if let Some(mut child) = child {
            if let Some(stdout) = child.stdout.take() {
                forward_lines(stdout, incoming_tx.clone());
            }
            if let Some(stderr) = child.stderr.take() {
                forward_lines(stderr, incoming_tx);
            }
            client.process = Some(Arc::new(Mutex::new(child)));
        }
        client.socket = Some(socket);
        Ok((client, incoming))
    }

    /// A client over any pair of streams; the adapter's messages arrive on the receiver.
    /// `process` is the adapter talking over these streams, whose exit status explains why they
    /// closed.
    fn from_streams(
        reader: impl Read + Send + 'static,
        writer: impl Write + Send + 'static,
        process: Option<Arc<Mutex<Child>>>,
    ) -> (Self, UnboundedSender<Incoming>, UnboundedReceiver<Incoming>) {
        let (incoming_tx, incoming) = unbounded();
        let (writer_tx, writer_rx) = mpsc::channel::<Value>();
        let pending: Pending = Arc::default();

        thread::spawn(move || {
            let mut writer = writer;
            while let Ok(message) = writer_rx.recv() {
                if write_message(&mut writer, &message).is_err() {
                    break;
                }
            }
        });

        let reader_pending = pending.clone();
        let reader_tx = incoming_tx.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            let reason = loop {
                match read_message(&mut reader) {
                    Ok(Some(message)) => route(message, &reader_pending, &reader_tx),
                    Ok(None) => {
                        break process
                            .as_ref()
                            .and_then(exit_status)
                            .map_or_else(|| "the debug adapter closed the connection".to_string(), |status| format!("the debug adapter exited with status {status}"));
                    }
                    Err(error) => break format!("{error:#}"),
                }
            };
            let waiters = match reader_pending.lock() {
                Ok(mut pending) => {
                    pending.closed = Some(reason.clone());
                    std::mem::take(&mut pending.waiters)
                }
                Err(_) => HashMap::new(),
            };
            for waiter in waiters.into_values() {
                waiter.send(Err(anyhow!("{reason}"))).ok();
            }
            reader_tx.unbounded_send(Incoming::Closed(reason)).ok();
        });

        let client = Self { writer: writer_tx, next_seq: AtomicI64::new(1), pending, process: None, socket: None };
        (client, incoming_tx, incoming)
    }

    /// Sends a request now and returns its response body; a response with `success: false`
    /// becomes an error carrying the adapter's message.
    pub fn request(&self, command: &str, arguments: Value) -> impl Future<Output = Result<Value>> + use<> {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        let sent = match self.pending.lock() {
            Ok(mut pending) => match &pending.closed {
                Some(reason) => Err(anyhow!("{reason}")),
                None => {
                    pending.waiters.insert(seq, tx);
                    let message = json!({ "seq": seq, "type": "request", "command": command, "arguments": arguments });
                    self.writer.send(message).map_err(|_| {
                        pending.waiters.remove(&seq);
                        anyhow!("the debug adapter connection is closed")
                    })
                }
            },
            Err(_) => Err(anyhow!("the debug adapter connection is broken")),
        };
        let command = command.to_string();
        async move {
            sent?;
            rx.await.map_err(|_| anyhow!("the debug adapter did not answer `{command}`"))?
        }
    }

    /// Answers one of the adapter's reverse requests.
    pub fn respond(&self, request_seq: i64, command: &str, result: Result<Value, String>) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let mut response = json!({ "seq": seq, "type": "response", "request_seq": request_seq, "command": command });
        match result {
            Ok(body) => {
                response["success"] = true.into();
                response["body"] = body;
            }
            Err(message) => {
                response["success"] = false.into();
                response["message"] = message.into();
            }
        }
        self.writer.send(response).ok();
    }

    /// Ends the connection and stops the adapter process, if this client started one.
    pub fn shutdown(&self) {
        if let Some(socket) = &self.socket {
            socket.shutdown(Shutdown::Both).ok();
        }
        if let Some(process) = &self.process {
            let process = process.clone();
            thread::spawn(move || {
                if let Ok(mut child) = process.lock() {
                    child.kill().ok();
                    child.wait().ok();
                }
            });
        }
    }
}

impl Drop for DapClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn route(message: Value, pending: &Pending, incoming: &UnboundedSender<Incoming>) {
    match message.get("type").and_then(Value::as_str) {
        Some("response") => {
            let Some(request_seq) = message.get("request_seq").and_then(Value::as_i64) else { return };
            let Some(waiter) = pending.lock().ok().and_then(|mut pending| pending.waiters.remove(&request_seq)) else { return };
            let body = message.get("body").cloned().unwrap_or(Value::Null);
            let result = if message.get("success").and_then(Value::as_bool).unwrap_or(false) {
                Ok(body)
            } else {
                Err(anyhow!("{}", error_message(&message, &body)))
            };
            waiter.send(result).ok();
        }
        Some("event") => {
            let event = message.get("event").and_then(Value::as_str).unwrap_or_default().to_string();
            let body = message.get("body").cloned().unwrap_or(Value::Null);
            incoming.unbounded_send(Incoming::Event { event, body }).ok();
        }
        Some("request") => {
            let seq = message.get("seq").and_then(Value::as_i64).unwrap_or_default();
            let command = message.get("command").and_then(Value::as_str).unwrap_or_default().to_string();
            let arguments = message.get("arguments").cloned().unwrap_or(Value::Null);
            incoming.unbounded_send(Incoming::Request { seq, command, arguments }).ok();
        }
        _ => {}
    }
}

/// A failed response's text: its structured error with `{placeholders}` filled in, else its
/// `message`.
fn error_message(response: &Value, body: &Value) -> String {
    if let Some(error) = body.get("error")
        && let Some(format) = error.get("format").and_then(Value::as_str)
    {
        let mut text = format.to_string();
        if let Some(variables) = error.get("variables").and_then(Value::as_object) {
            for (name, value) in variables {
                text = text.replace(&format!("{{{name}}}"), value.as_str().unwrap_or_default());
            }
        }
        return text;
    }
    match response.get("message").and_then(Value::as_str) {
        Some(message) if !message.is_empty() => message.to_string(),
        _ => format!("the debug adapter rejected `{}`", response.get("command").and_then(Value::as_str).unwrap_or("request")),
    }
}

/// How long a closed adapter gets to report its exit status.
const EXIT_STATUS_WAIT: Duration = Duration::from_secs(1);

/// The adapter's exit status once it has exited, waiting briefly after its output closed.
fn exit_status(process: &Arc<Mutex<Child>>) -> Option<std::process::ExitStatus> {
    let started = Instant::now();
    loop {
        if let Some(status) = process.lock().ok()?.try_wait().ok()? {
            return Some(status);
        }
        if started.elapsed() > EXIT_STATUS_WAIT {
            return None;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn forward_lines(stream: impl Read + Send + 'static, incoming: UnboundedSender<Incoming>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let text = line.trim_end();
                    if !text.is_empty() && incoming.unbounded_send(Incoming::Log(text.to_string())).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// A free local TCP port for an adapter to listen on.
pub fn free_port() -> Result<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_errors_fill_their_variables() {
        let body = json!({ "error": { "id": 1, "format": "Unable to find {name}", "variables": { "name": "x" } } });
        assert_eq!(error_message(&json!({ "message": "evaluate" }), &body), "Unable to find x");
        assert_eq!(error_message(&json!({ "message": "nope" }), &Value::Null), "nope");
        assert_eq!(error_message(&json!({ "command": "next" }), &Value::Null), "the debug adapter rejected `next`");
    }

    #[test]
    fn requests_fail_once_the_adapter_closes() {
        let (client, mut incoming) = DapClient::spawn(&AdapterCommand { program: "true".into(), ..Default::default() }).unwrap();
        let response = futures::executor::block_on(client.request("initialize", json!({})));
        assert!(response.is_err());
        let closed = futures::executor::block_on(async {
            use futures::StreamExt as _;
            while let Some(message) = incoming.next().await {
                if let Incoming::Closed(reason) = message {
                    return Some(reason);
                }
            }
            None
        });
        assert!(closed.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn a_closed_adapter_reports_its_exit_status() {
        let adapter = AdapterCommand { program: "sh".into(), args: vec!["-c".into(), "exit 3".into()], ..Default::default() };
        let (_client, mut incoming) = DapClient::spawn(&adapter).unwrap();
        let closed = futures::executor::block_on(async {
            use futures::StreamExt as _;
            while let Some(message) = incoming.next().await {
                if let Incoming::Closed(reason) = message {
                    return Some(reason);
                }
            }
            None
        });
        let reason = closed.unwrap();
        assert!(reason.starts_with("the debug adapter exited with status"), "{reason}");
        assert!(reason.contains('3'), "{reason}");
    }
}
