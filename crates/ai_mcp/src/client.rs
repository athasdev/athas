//! A minimal MCP client: the initialize handshake, `tools/list` and `tools/call`, over
//! newline-delimited JSON-RPC, Streamable HTTP or the older HTTP+SSE transport (`http.rs`). A
//! stdio server runs as a child process in its own process group; plain threads read its output
//! and make the HTTP requests, so the client's futures run on any executor. There are no
//! timeouts here: callers race their own timer and drop the future.

use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
    },
    time::{Duration, Instant},
};

use futures::channel::oneshot;
use serde_json::{Map, Value, json};

use crate::servers::{McpServerConfig, McpTransportKind, named_values, resolve};

pub(crate) const PROTOCOL_VERSION: &str = "2025-06-18";
/// Characters of one tool result the model receives.
const RESULT_CHARS: usize = 20_000;
/// Tools taken from one server; a server listing more is cut off.
const MAX_TOOLS: usize = 100;
const MAX_LIST_PAGES: usize = 10;
const MAX_DESCRIPTION_CHARS: usize = 1_000;
/// Stderr lines kept to explain a server that exits early.
const STDERR_LINES: usize = 20;
/// A message longer than this is dropped rather than parsed.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const TOOL_NAME_PREFIX: &str = "mcp__";
/// Providers such as OpenAI reject longer tool names.
const MAX_TOOL_NAME_LENGTH: usize = 64;

/// A tool as the server lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct McpTool {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
    /// Always a JSON Schema object, as providers require.
    pub input_schema: Value,
    /// The server says the tool changes nothing (`annotations.readOnlyHint`).
    pub read_only: bool,
}

/// A `tools/call` result reduced to the text the model receives.
#[derive(Clone, Debug, PartialEq)]
pub struct McpToolOutput {
    pub content: String,
    pub is_error: bool,
    pub truncated: bool,
}

type Answer = oneshot::Sender<Result<Value, String>>;

#[derive(Default)]
struct State {
    pending: HashMap<i64, Answer>,
    /// Why the connection ended; requests fail with it from then on.
    closed: Option<String>,
}

/// Delivers one message to the server: a line on stdin, or an HTTP POST.
pub(crate) type Sender = Box<dyn FnMut(&Value) -> Result<(), String> + Send>;

pub(crate) struct Connection {
    pub(crate) name: String,
    sender: Mutex<Option<Sender>>,
    state: Mutex<State>,
    next_id: AtomicI64,
    /// The version `initialize` agreed on, which HTTP requests repeat in a header.
    pub(crate) protocol_version: Mutex<Option<String>>,
}

impl Connection {
    pub(crate) fn new(name: String) -> Arc<Connection> {
        Arc::new(Connection {
            name,
            sender: Mutex::new(None),
            state: Mutex::default(),
            next_id: AtomicI64::new(1),
            protocol_version: Mutex::new(None),
        })
    }

    pub(crate) fn set_sender(&self, sender: Sender) {
        *self.sender.lock().unwrap_or_else(|p| p.into_inner()) = Some(sender);
    }

    fn send(&self, message: &Value) -> Result<(), String> {
        let mut sender = self.sender.lock().unwrap_or_else(|p| p.into_inner());
        let Some(sender) = sender.as_mut() else { return Err(format!("{} was closed.", self.name)) };
        sender(message)
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(reason) = &state.closed {
                return Err(reason.clone());
            }
            state.pending.insert(id, tx);
        }
        // A failed write means the server is going away; the reader then fails this request with
        // the reason, which says more than the broken pipe.
        let _ = self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        // Dropped before the answer (a timeout, Stop): the entry goes and the server hears it
        // can stop, rather than running the tool on with its answer kept waiting forever.
        struct Abandon<'a> {
            connection: &'a Connection,
            id: i64,
            done: bool,
        }
        impl Drop for Abandon<'_> {
            fn drop(&mut self) {
                if self.done {
                    return;
                }
                let removed = self.connection.state.lock().unwrap_or_else(|p| p.into_inner()).pending.remove(&self.id).is_some();
                if removed {
                    let _ = self.connection.send(&json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": self.id, "reason": "The request was cancelled" } }));
                }
            }
        }
        let mut guard = Abandon { connection: self, id, done: false };
        let answer = rx.await.unwrap_or_else(|_| Err(format!("{} was closed.", self.name)));
        guard.done = true;
        answer
    }

    fn notify(&self, method: &str) {
        let _ = self.send(&json!({ "jsonrpc": "2.0", "method": method }));
    }

    /// Ends the connection: waiting requests fail with `reason` and the server's input closes.
    pub(crate) fn close(&self, reason: String) {
        let pending = {
            let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if state.closed.is_none() {
                state.closed = Some(reason.clone());
            }
            std::mem::take(&mut state.pending)
        };
        for (_, answer) in pending {
            let _ = answer.send(Err(reason.clone()));
        }
        let sender = self.sender.lock().unwrap_or_else(|p| p.into_inner()).take();
        drop(sender);
    }

    /// Handles a line or body from the server: one message or a batch of them.
    pub(crate) fn receive(&self, text: &str) {
        match serde_json::from_str::<Value>(text) {
            Ok(Value::Array(messages)) => messages.into_iter().for_each(|message| self.receive_message(message)),
            Ok(message) => self.receive_message(message),
            Err(_) => {}
        }
    }

    /// An answer, a request, or a notification (ignored).
    fn receive_message(&self, message: Value) {
        if !message.is_object() {
            return;
        }
        let id = message.get("id").filter(|id| !id.is_null());
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            // Requests from the server: answer what needs no capability, refuse the rest.
            if let Some(id) = id {
                let reply = match method {
                    "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
                    "roots/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "roots": [] } }),
                    _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Athas does not support {method}") } }),
                };
                let _ = self.send(&reply);
            }
            return;
        }
        let Some(id) = id.and_then(Value::as_i64) else { return };
        let Some(answer) = self.state.lock().unwrap_or_else(|p| p.into_inner()).pending.remove(&id) else { return };
        let result = match message.get("error") {
            Some(error) => Err(error
                .get("message")
                .and_then(Value::as_str)
                .filter(|message| !message.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("MCP error {}", error.get("code").and_then(Value::as_i64).unwrap_or_default()))),
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = answer.send(result);
    }
}

/// A connected MCP server. Dropping it stops the server.
pub struct McpClient {
    pub(crate) connection: Arc<Connection>,
    /// The server's process, for a stdio server.
    process: Option<Child>,
}

impl McpClient {
    /// Connects to a server and runs the initialize handshake. A stdio server is started; a bare
    /// command such as `npx` is resolved with `resolve_command`, and its folder goes first on
    /// `PATH` so a script finds its interpreter (`node`) when the app was not started from a
    /// shell. HTTP and SSE servers are reached at their URL with the server's secret headers.
    pub async fn start(
        config: &McpServerConfig,
        cwd: Option<&Path>,
        resolve_command: impl Fn(&str) -> Option<PathBuf>,
    ) -> Result<McpClient, String> {
        let name = config.setting.name.trim().to_string();
        match config.setting.transport {
            McpTransportKind::Stdio => {}
            McpTransportKind::Http => return Self::connected(crate::http::connect_http(config)?).await,
            McpTransportKind::Sse => return Self::connected(crate::http::connect_sse(config).await?).await,
        }
        let program = resolve(config.setting.command.trim(), resolve_command);
        let mut command = Command::new(&program);
        command.args(&config.setting.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(folder) = program.parent().filter(|folder| folder.is_absolute()) {
            let mut path = vec![folder.to_path_buf()];
            path.extend(std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect::<Vec<_>>()).unwrap_or_default());
            if let Ok(path) = std::env::join_paths(path) {
                command.env("PATH", path);
            }
        }
        for (variable, value) in named_values(&config.secrets.env) {
            command.env(variable, value);
        }
        if let Some(cwd) = cwd.filter(|cwd| cwd.is_dir()) {
            command.current_dir(cwd);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|error| format!("{name}: could not start {}: {error}", program.display()))?;
        let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Err(format!("{name}: could not connect to the server."));
        };
        let tail = Arc::new(Mutex::new(VecDeque::new()));
        let stderr_reader = {
            let tail = tail.clone();
            std::thread::spawn(move || {
                for line in lossy_lines(stderr) {
                    let mut tail = tail.lock().unwrap_or_else(|p| p.into_inner());
                    if tail.len() == STDERR_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            })
        };
        let connection = Self::run(name, BufReader::new(stdout), stdin, move || {
            // Give stderr a moment to catch up with an exit, to say why.
            let deadline = Instant::now() + Duration::from_millis(200);
            while !stderr_reader.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            tail.lock().unwrap_or_else(|p| p.into_inner()).iter().cloned().collect::<Vec<_>>().join("\n")
        });
        let client = McpClient { connection, process: Some(child) };
        client.initialize().await?;
        Ok(client)
    }

    async fn connected(connection: Arc<Connection>) -> Result<McpClient, String> {
        let client = McpClient { connection, process: None };
        client.initialize().await?;
        Ok(client)
    }

    /// Connects over any line transport, then initializes.
    pub async fn connect(
        name: String,
        reader: impl BufRead + Send + 'static,
        writer: impl Write + Send + 'static,
    ) -> Result<McpClient, String> {
        let connection = Self::run(name, reader, writer, String::new);
        let client = McpClient { connection, process: None };
        client.initialize().await?;
        Ok(client)
    }

    /// Starts the thread that reads the server's messages until it hangs up; `stderr_tail` says
    /// why it did.
    fn run(
        name: String,
        mut reader: impl BufRead + Send + 'static,
        writer: impl Write + Send + 'static,
        stderr_tail: impl FnOnce() -> String + Send + 'static,
    ) -> Arc<Connection> {
        let connection = Connection::new(name);
        let mut writer = writer;
        let label = connection.name.clone();
        connection.set_sender(Box::new(move |message| {
            writeln!(writer, "{message}").and_then(|_| writer.flush()).map_err(|error| format!("{label}: {error}"))
        }));
        let reading = connection.clone();
        std::thread::spawn(move || {
            let mut line = Vec::new();
            loop {
                line.clear();
                match (&mut reader).take(MAX_LINE_BYTES as u64 + 1).read_until(b'\n', &mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) if line.len() > MAX_LINE_BYTES && !line.ends_with(b"\n") => {
                        // Skip the rest of an oversized message.
                        let mut rest = Vec::new();
                        if reader.read_until(b'\n', &mut rest).is_err() {
                            break;
                        }
                    }
                    Ok(_) => reading.receive(String::from_utf8_lossy(&line).trim()),
                }
            }
            let tail = stderr_tail();
            let reason = if tail.trim().is_empty() {
                format!("{} stopped.", reading.name)
            } else {
                format!("{} stopped: {}", reading.name, tail.trim())
            };
            reading.close(reason);
        });
        connection
    }

    async fn initialize(&self) -> Result<(), String> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "athas", "version": env!("CARGO_PKG_VERSION") },
        });
        let result = self.connection.request("initialize", params).await?;
        let version = result.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION).to_string();
        *self.connection.protocol_version.lock().unwrap_or_else(|p| p.into_inner()) = Some(version);
        self.connection.notify("notifications/initialized");
        Ok(())
    }

    pub fn name(&self) -> &str {
        &self.connection.name
    }

    /// The server's tools, following `nextCursor` for a few pages, at most 100.
    pub async fn list_tools(&self) -> Result<Vec<McpTool>, String> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let result = self.connection.request("tools/list", params).await?;
            let Some(entries) = result.get("tools").and_then(Value::as_array) else { break };
            tools.extend(entries.iter().filter_map(tool_info));
            cursor = result.get("nextCursor").and_then(Value::as_str).map(str::to_string);
            if cursor.is_none() || tools.len() >= MAX_TOOLS {
                break;
            }
        }
        tools.truncate(MAX_TOOLS);
        Ok(tools)
    }

    pub async fn call_tool(&self, tool: &str, arguments: Value) -> Result<McpToolOutput, String> {
        let arguments = if arguments.is_object() { arguments } else { json!({}) };
        let result = self.connection.request("tools/call", json!({ "name": tool, "arguments": arguments })).await?;
        Ok(tool_output(&result))
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        self.connection.close(format!("{} was closed.", self.connection.name));
        if let Some(mut child) = self.process.take() {
            kill_process_group(child.id());
            let _ = child.kill();
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
    }
}

fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    if pid > 0 && pid <= libc::pid_t::MAX as u32 {
        // SAFETY: signals the group the server leads (`process_group(0)`), nothing else.
        unsafe {
            libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
}

fn tool_info(entry: &Value) -> Option<McpTool> {
    let name = entry.get("name").and_then(Value::as_str).filter(|name| !name.is_empty())?;
    Some(McpTool {
        name: name.to_string(),
        title: entry.get("title").and_then(Value::as_str).map(str::to_string),
        description: entry.get("description").and_then(Value::as_str).unwrap_or_default().chars().take(MAX_DESCRIPTION_CHARS).collect(),
        input_schema: input_schema(entry.get("inputSchema")),
        read_only: entry.pointer("/annotations/readOnlyHint").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// Tool inputs must be JSON Schema objects with `properties`; anything else becomes an empty
/// object schema.
fn input_schema(schema: Option<&Value>) -> Value {
    let Some(Value::Object(schema)) = schema else { return json!({ "type": "object", "properties": {} }) };
    if schema.get("type").is_some_and(|kind| kind != "object") {
        return json!({ "type": "object", "properties": {} });
    }
    let mut schema: Map<String, Value> = schema.clone();
    schema.remove("$schema");
    schema.insert("type".into(), json!("object"));
    if !schema.get("properties").is_some_and(Value::is_object) {
        schema.insert("properties".into(), json!({}));
    }
    Value::Object(schema)
}

/// Joins a result's content into text, capped at 20,000 characters.
fn tool_output(result: &Value) -> McpToolOutput {
    let mut parts = Vec::new();
    for item in result.get("content").and_then(Value::as_array).into_iter().flatten() {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or_default();
        let text = |key: &str| item.get(key).and_then(Value::as_str);
        match kind {
            "text" => parts.extend(text("text").map(str::to_string)),
            "image" | "audio" => parts.push(match text("mimeType") {
                Some(mime) => format!("[{kind} omitted: {mime}]"),
                None => format!("[{kind} omitted]"),
            }),
            "resource" => {
                if let Some(resource) = item.get("resource") {
                    parts.push(match resource.get("text").and_then(Value::as_str) {
                        Some(text) => text.to_string(),
                        None => format!("[resource {}]", resource.get("uri").and_then(Value::as_str).unwrap_or_default()),
                    });
                }
            }
            "resource_link" => parts.extend(text("uri").map(|uri| format!("[resource {uri}]"))),
            _ => {}
        }
    }
    if parts.is_empty()
        && let Some(structured) = result.get("structuredContent")
    {
        parts.push(structured.to_string());
    }
    let text = parts.join("\n\n");
    let length = text.chars().count();
    let (content, truncated) = if length > RESULT_CHARS {
        let kept: String = text.chars().take(RESULT_CHARS).collect();
        (format!("{kept}\n… [{} more characters not shown]", length - RESULT_CHARS), true)
    } else {
        (text, false)
    };
    McpToolOutput { content, is_error: result.get("isError").and_then(Value::as_bool).unwrap_or(false), truncated }
}

fn slug(value: &str) -> String {
    let mut slug = String::new();
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            slug.push(ch);
        } else if !slug.ends_with('_') {
            slug.push('_');
        }
    }
    slug.trim_matches('_').to_string()
}

/// The name a model sees for `tool` on `server`: `mcp__<server>__<tool>`, the convention ACP
/// agents use. Server slugs never contain `__`, so the name splits back unambiguously.
pub fn model_tool_name(server_name: &str, tool: &str) -> String {
    let mut server = slug(server_name);
    while server.contains("__") {
        server = server.replace("__", "_");
    }
    if server.is_empty() {
        server = "server".into();
    }
    let tool = Some(slug(tool)).filter(|tool| !tool.is_empty()).unwrap_or_else(|| "tool".into());
    let mut name = format!("{TOOL_NAME_PREFIX}{server}__{tool}");
    name.truncate(MAX_TOOL_NAME_LENGTH);
    name
}

/// Splits an `mcp__<server>__<tool>` name back into its server and tool slugs.
pub fn parse_model_tool_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix(TOOL_NAME_PREFIX)?;
    let separator = rest.find("__")?;
    let (server, tool) = (&rest[..separator], &rest[separator + 2..]);
    (!server.is_empty() && !tool.is_empty()).then_some((server, tool))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{McpServerSecrets, McpServerSetting};
    use futures::executor::block_on;
    use std::os::unix::net::UnixStream;

    /// A server that answers initialize, two pages of tools and calls, then hangs up when told.
    fn fake_server(stream: UnixStream) {
        let mut writer = stream.try_clone().unwrap();
        let mut reply = |value: Value| writeln!(writer, "{value}").unwrap();
        for line in BufReader::new(stream).lines() {
            let message: Value = serde_json::from_str(&line.unwrap()).unwrap();
            let id = message["id"].clone();
            let Some(method) = message["method"].as_str() else {
                assert_eq!(message, json!({ "jsonrpc": "2.0", "id": "srv-1", "result": {} }));
                continue;
            };
            match method {
                "initialize" => {
                    assert_eq!(message["params"]["protocolVersion"], PROTOCOL_VERSION);
                    // A request of the server's own comes first; the client answers it.
                    reply(json!({ "jsonrpc": "2.0", "id": "srv-1", "method": "ping" }));
                    reply(json!({ "jsonrpc": "2.0", "id": id, "result": { "protocolVersion": PROTOCOL_VERSION } }));
                }
                "notifications/initialized" => {}
                "tools/list" if message["params"]["cursor"].is_null() => reply(json!({ "jsonrpc": "2.0", "id": id, "result": {
                    "tools": [{ "name": "search", "description": "Find", "inputSchema": { "$schema": "x", "type": "object" },
                                "annotations": { "readOnlyHint": true } }, { "description": "nameless" }],
                    "nextCursor": "2" } })),
                "tools/list" => reply(json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": [{ "name": "write", "inputSchema": { "type": "string" } }] } })),
                "tools/call" if message["params"]["name"] == "fail" => {
                    reply(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": "No such tool" } }))
                }
                "tools/call" if message["params"]["name"] == "quit" => return,
                "tools/call" => reply(json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [
                    { "type": "text", "text": format!("args {}", message["params"]["arguments"]) },
                    { "type": "image", "mimeType": "image/png", "data": "..." }
                ], "isError": false } })),
                _ => {}
            }
        }
    }

    #[test]
    fn talks_to_a_server_over_any_line_transport() {
        let (client_end, server_end) = UnixStream::pair().unwrap();
        let server = std::thread::spawn(move || fake_server(server_end));
        let reader = BufReader::new(client_end.try_clone().unwrap());
        let client = block_on(McpClient::connect("Search".into(), reader, client_end)).unwrap();
        assert_eq!(client.name(), "Search");

        let tools = block_on(client.list_tools()).unwrap();
        assert_eq!(tools.iter().map(|tool| tool.name.as_str()).collect::<Vec<_>>(), ["search", "write"]);
        assert!(tools[0].read_only && !tools[1].read_only);
        assert_eq!(tools[0].input_schema, json!({ "type": "object", "properties": {} }));
        assert_eq!(tools[1].input_schema, json!({ "type": "object", "properties": {} }));

        let output = block_on(client.call_tool("search", json!({ "q": "x" }))).unwrap();
        assert_eq!(output.content, "args {\"q\":\"x\"}\n\n[image omitted: image/png]");
        assert!(!output.is_error && !output.truncated);
        assert_eq!(block_on(client.call_tool("search", json!("not an object"))).unwrap().content, "args {}\n\n[image omitted: image/png]");
        assert_eq!(block_on(client.call_tool("fail", json!({}))).unwrap_err(), "No such tool");

        assert_eq!(block_on(client.call_tool("quit", json!({}))).unwrap_err(), "Search stopped.");
        assert_eq!(block_on(client.list_tools()).unwrap_err(), "Search stopped.");
        server.join().unwrap();
    }

    #[test]
    fn results_are_reduced_to_capped_text() {
        let long = "a".repeat(RESULT_CHARS + 5);
        let output = tool_output(&json!({ "content": [{ "type": "text", "text": long }], "isError": true }));
        assert!(output.truncated && output.is_error);
        assert!(output.content.ends_with("[5 more characters not shown]"));
        let output = tool_output(&json!({ "content": [
            { "type": "resource", "resource": { "uri": "file:///a", "text": "body" } },
            { "type": "resource", "resource": { "uri": "file:///b" } },
            { "type": "resource_link", "uri": "file:///c" }
        ] }));
        assert_eq!(output.content, "body\n\n[resource file:///b]\n\n[resource file:///c]");
        assert_eq!(tool_output(&json!({ "structuredContent": { "n": 1 } })).content, "{\"n\":1}");
    }

    #[test]
    fn model_tool_names() {
        assert_eq!(model_tool_name("GitHub", "search_issues"), "mcp__GitHub__search_issues");
        assert_eq!(model_tool_name(" My  Server!! ", "do.thing"), "mcp__My_Server__do_thing");
        assert_eq!(model_tool_name("a__b", "x"), "mcp__a_b__x");
        assert_eq!(model_tool_name("???", ""), "mcp__server__tool");
        assert_eq!(model_tool_name("server", &"t".repeat(100)).len(), MAX_TOOL_NAME_LENGTH);
        assert_eq!(parse_model_tool_name("mcp__a_b__x__y"), Some(("a_b", "x__y")));
        assert_eq!(parse_model_tool_name("read_file"), None);
        assert_eq!(parse_model_tool_name("mcp____x"), None);
    }

    #[test]
    fn a_server_that_exits_says_why() {
        let script = r#"read line; echo '{"jsonrpc":"2.0","id":1,"result":{}}'; read line; read line; echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo"}]}}'; echo "missing $TOKEN" >&2; exit 1"#;
        let config = McpServerConfig {
            setting: McpServerSetting {
                id: "sh".into(),
                name: "Shell".into(),
                enabled: true,
                transport: McpTransportKind::Stdio,
                command: "sh".into(),
                args: vec!["-c".into(), script.into()],
                url: String::new(),
            },
            secrets: McpServerSecrets { env: vec![crate::McpNameValue { name: "TOKEN".into(), value: "key".into() }], headers: Vec::new() },
        };
        let client = block_on(McpClient::start(&config, None, |_| Some("/bin/sh".into()))).unwrap();
        assert_eq!(block_on(client.list_tools()).unwrap()[0].name, "echo");
        let error = block_on(client.call_tool("echo", json!({}))).unwrap_err();
        assert_eq!(error, "Shell stopped: missing key");
    }
}

/// The lines `reader` gives, decoded lossily: a byte that is not UTF-8 (a log line in another
/// encoding) becomes U+FFFD instead of ending the read. `BufRead::lines` stops there, and a
/// stderr nobody drains makes the process block once its pipe is full.
fn lossy_lines(reader: impl std::io::Read) -> impl Iterator<Item = String> {
    use std::io::BufRead as _;
    let mut reader = std::io::BufReader::new(reader);
    std::iter::from_fn(move || {
        let mut bytes = Vec::new();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => None,
            Ok(_) => {
                while bytes.last().is_some_and(|byte| *byte == b'\n' || *byte == b'\r') {
                    bytes.pop();
                }
                Some(String::from_utf8_lossy(&bytes).into_owned())
            }
        }
    })
}
