//! The socket side: one listener for the workspace WebSocket, `POST /call`, `GET /workspace` and
//! the web build's own files. Every connection gets a thread; nothing here needs an async runtime.

use std::{
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    sync::{Arc, mpsc},
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;
use tungstenite::{
    Message, WebSocket,
    protocol::{CloseFrame, frame::coding::CloseCode},
};
use web_protocol::{
    CallOutcome, CallRequest, ClientMessage, MAX_SOCKET_MESSAGE_BYTES, SOCKET_UNAUTHORIZED, ServerMessage, encode_terminal_frame,
};

use crate::{Outgoing, Workspace};

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const POLL_INTERVAL: Duration = Duration::from_millis(15);
const MAX_HEAD_BYTES: usize = 16 * 1024;

pub struct ServerConfig {
    /// What clients authenticate with: the socket's first message, or `Authorization: Bearer`.
    pub token: String,
    /// The web build's files (`index.html`, the wasm and its glue), served from `/`.
    pub web_dir: Option<PathBuf>,
}

impl ServerConfig {
    fn accepts(&self, token: &str) -> bool {
        let (expected, given) = (self.token.as_bytes(), token.as_bytes());
        expected.len() == given.len() && expected.iter().zip(given).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
    }
}

/// Serves `workspace` on `listener` until the listener fails.
pub fn serve(listener: TcpListener, workspace: Arc<Workspace>, config: Arc<ServerConfig>) -> io::Result<()> {
    for stream in listener.incoming() {
        let stream = stream?;
        let (workspace, config) = (workspace.clone(), config.clone());
        thread::Builder::new().name("athas-server-connection".into()).spawn(move || {
            let _ = handle(stream, &workspace, &config);
        })?;
    }
    Ok(())
}

/// The request head, read without consuming it so a WebSocket handshake can read it again.
fn peek_head(stream: &TcpStream) -> io::Result<Vec<u8>> {
    let mut buffer = vec![0u8; MAX_HEAD_BYTES];
    let started = Instant::now();
    loop {
        let read = stream.peek(&mut buffer)?;
        if read == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        if let Some(end) = buffer[..read].windows(4).position(|window| window == b"\r\n\r\n") {
            buffer.truncate(end + 4);
            return Ok(buffer);
        }
        if read == buffer.len() || started.elapsed() > AUTH_TIMEOUT {
            return Err(io::ErrorKind::InvalidData.into());
        }
        thread::sleep(POLL_INTERVAL);
    }
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
}

impl Request {
    fn parse(head: &[u8]) -> Option<Self> {
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut request = httparse::Request::new(&mut headers);
        request.parse(head).ok()?;
        Some(Self {
            method: request.method?.to_string(),
            path: request.path?.to_string(),
            headers: request.headers.iter().map(|header| (header.name.to_ascii_lowercase(), String::from_utf8_lossy(header.value).into_owned())).collect(),
        })
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }
}

fn handle(stream: TcpStream, workspace: &Workspace, config: &ServerConfig) -> io::Result<()> {
    stream.set_read_timeout(Some(AUTH_TIMEOUT))?;
    let head = peek_head(&stream)?;
    let request = Request::parse(&head).ok_or(io::ErrorKind::InvalidData)?;
    if request.header("upgrade").is_some_and(|upgrade| upgrade.eq_ignore_ascii_case("websocket")) {
        let socket = tungstenite::accept(stream).map_err(|error| io::Error::other(error.to_string()))?;
        return run_socket(socket, workspace, config);
    }
    let mut stream = stream;
    let mut discard = vec![0u8; head.len()];
    stream.read_exact(&mut discard)?;
    let length: usize = request.header("content-length").and_then(|length| length.trim().parse().ok()).unwrap_or(0);
    if length > MAX_SOCKET_MESSAGE_BYTES {
        return respond(&mut stream, 413, "text/plain", b"Too large");
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body)?;
    let path = request.path.split('?').next().unwrap_or("/").to_string();
    let bearer = request.header("authorization").and_then(|value| value.strip_prefix("Bearer ")).map(str::trim);
    let authorized = bearer.is_some_and(|token| config.accepts(token));
    match (request.method.as_str(), path.as_str()) {
        ("OPTIONS", _) => respond(&mut stream, 204, "text/plain", b""),
        ("POST", "/call") if authorized => {
            let outcome = match serde_json::from_slice::<CallRequest>(&body) {
                Ok(call) if call.method == "terminal.attach" => CallOutcome::from_result(Err(web_protocol::CallError::new("socket_only", "Attach over the socket."))),
                Ok(call) => CallOutcome::from_result(workspace.call(&call.method, &call.params)),
                Err(error) => CallOutcome::from_result(Err(web_protocol::CallError::invalid(error.to_string()))),
            };
            respond(&mut stream, 200, "application/json", &serde_json::to_vec(&outcome).unwrap_or_default())
        }
        ("GET", "/workspace") if authorized => respond(&mut stream, 200, "application/json", &serde_json::to_vec(&workspace.info()).unwrap_or_default()),
        ("POST", "/call") | ("GET", "/workspace") => respond(&mut stream, 401, "text/plain", b"Unauthorized"),
        ("GET", _) if path.starts_with(PREVIEW_PREFIX) => match preview_file(workspace, &path) {
            Some((content_type, bytes)) => respond_with(&mut stream, 200, content_type, PREVIEW_HEADERS, &bytes),
            None => respond(&mut stream, 404, "text/plain", b"Not found"),
        },
        ("GET", _) => match config.web_dir.as_deref().and_then(|dir| static_file(dir, &path)) {
            Some((content_type, bytes)) => respond(&mut stream, 200, content_type, &bytes),
            None => respond(&mut stream, 404, "text/plain", b"Not found"),
        },
        _ => respond(&mut stream, 405, "text/plain", b"Method not allowed"),
    }
}

fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) -> io::Result<()> {
    respond_with(stream, status, content_type, "", body)
}

fn respond_with(stream: &mut TcpStream, status: u16, content_type: &str, headers: &str, body: &[u8]) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        _ => "Error",
    };
    // Tokens travel in a header, never a cookie, so any page may call; the token is the gate.
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\n{headers}Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

/// A file of the web build, never one outside its folder.
fn static_file(dir: &Path, path: &str) -> Option<(&'static str, Vec<u8>)> {
    let relative = Path::new(path.trim_start_matches('/'));
    if relative.components().any(|component| !matches!(component, Component::Normal(_))) {
        return None;
    }
    let mut file = dir.join(relative);
    if path.ends_with('/') || file.is_dir() {
        file = file.join("index.html");
    }
    Some((content_type(&file), std::fs::read(file).ok()?))
}

fn content_type(file: &Path) -> &'static str {
    match file.extension().and_then(|extension| extension.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm" | "xhtml") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript",
        Some("wasm") => "application/wasm",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Where HTML previews are served: `/preview/<key>/<path in the workspace>`.
pub(crate) const PREVIEW_PREFIX: &str = "/preview/";
/// Previews are pages of the project, so they run in a sandbox of their own origin and never see
/// the workbench's token.
const PREVIEW_HEADERS: &str = "Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals\r\n";

/// A workspace file for an HTML preview, when the key is the workspace's preview key.
fn preview_file(workspace: &Workspace, path: &str) -> Option<(&'static str, Vec<u8>)> {
    let (key, relative) = path.strip_prefix(PREVIEW_PREFIX)?.split_once('/')?;
    let expected = workspace.preview_key.as_bytes();
    if key.len() != expected.len() || key.bytes().zip(expected).fold(0u8, |diff, (a, b)| diff | (a ^ b)) != 0 {
        return None;
    }
    let relative = percent_decode(relative)?;
    let mut file = web_protocol::resolve_path(&workspace.root, relative.trim_end_matches('/')).ok()?;
    if file.is_dir() {
        file = file.join("index.html");
    }
    Some((content_type(&file), std::fs::read(file).ok()?))
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn send(socket: &mut WebSocket<TcpStream>, message: &ServerMessage) -> tungstenite::Result<()> {
    socket.send(Message::text(message.to_json()))
}

fn close(socket: &mut WebSocket<TcpStream>, code: u16, reason: &str) {
    let _ = socket.close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.to_string().into() }));
    let _ = socket.flush();
}

fn is_timeout(error: &tungstenite::Error) -> bool {
    matches!(error, tungstenite::Error::Io(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut))
}

/// One workbench's socket: authenticates with its first message, then carries calls and their
/// results while pushing file changes and terminal output.
fn run_socket(mut socket: WebSocket<TcpStream>, workspace: &Workspace, config: &ServerConfig) -> io::Result<()> {
    socket.get_ref().set_read_timeout(Some(POLL_INTERVAL))?;
    let opened = Instant::now();
    let mut events: Option<mpsc::Receiver<Outgoing>> = None;
    loop {
        if let Some(events) = &events {
            while let Ok(event) = events.try_recv() {
                let message = match event {
                    Outgoing::Text(text) => Message::text(text),
                    Outgoing::Binary(bytes) => Message::binary(bytes),
                };
                if socket.send(message).is_err() {
                    return Ok(());
                }
            }
        } else if opened.elapsed() > AUTH_TIMEOUT {
            close(&mut socket, SOCKET_UNAUTHORIZED, "Authentication timed out");
            return Ok(());
        }
        let text = match socket.read() {
            Ok(Message::Text(text)) => text.to_string(),
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => continue,
            Err(error) if is_timeout(&error) => {
                let _ = socket.flush();
                continue;
            }
            Err(_) => return Ok(()),
        };
        let Some(message) = ClientMessage::parse(&text) else { continue };
        let result = match message {
            ClientMessage::Auth { token } | ClientMessage::Renew { token } if events.is_none() => {
                if !config.accepts(&token) {
                    close(&mut socket, SOCKET_UNAUTHORIZED, "Unauthorized");
                    return Ok(());
                }
                events = Some(workspace.subscribe());
                send(&mut socket, &ServerMessage::Ready { workspace: workspace.info() })
            }
            _ if events.is_none() => {
                close(&mut socket, SOCKET_UNAUTHORIZED, "Unauthorized");
                return Ok(());
            }
            ClientMessage::Auth { .. } | ClientMessage::Renew { .. } => send(&mut socket, &ServerMessage::Renewed),
            ClientMessage::Ping => send(&mut socket, &ServerMessage::Pong),
            // Attaching replays a terminal's recent output to this socket only.
            ClientMessage::Call { id, method, params } if method == "terminal.attach" => {
                let terminal = params.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                let outcome = match workspace.terminal_backlog(&terminal) {
                    Some(backlog) => {
                        if !backlog.is_empty() && socket.send(Message::binary(encode_terminal_frame(&terminal, &backlog))).is_err() {
                            return Ok(());
                        }
                        CallOutcome::from_result(Ok(serde_json::json!({})))
                    }
                    None => CallOutcome::from_result(Err(web_protocol::CallError::new("not_found", "No such terminal."))),
                };
                send(&mut socket, &ServerMessage::Result { id, outcome })
            }
            ClientMessage::Call { id, method, params } => {
                let outcome = CallOutcome::from_result(workspace.call(&method, &params));
                send(&mut socket, &ServerMessage::Result { id, outcome })
            }
        };
        if result.is_err() {
            return Ok(());
        }
    }
}
