use crate::{
   auth::{authorize_upgrade, generate_auth_token},
   host::IdeHost,
   lock_file::{LockFile, LockFileContent},
   protocol::{IdeState, McpHandler, notification},
   selection::EditorSelection,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
   io,
   net::{Ipv4Addr, SocketAddr},
   path::PathBuf,
   sync::{Arc, Mutex},
   time::Duration,
};
use tokio::{
   net::{TcpListener, TcpStream},
   sync::{broadcast, mpsc},
   task::{JoinHandle, JoinSet},
};
use tokio_tungstenite::{
   accept_hdr_async,
   tungstenite::{
      Message,
      handshake::server::{ErrorResponse, Request, Response},
      http::header::SEC_WEBSOCKET_PROTOCOL,
   },
};

/// Tells a terminal's `claude` which IDE to connect to.
pub const PORT_ENV: &str = "CLAUDE_CODE_SSE_PORT";
pub const ENABLE_ENV: &str = "ENABLE_IDE_INTEGRATION";

const PING_INTERVAL: Duration = Duration::from_secs(30);
const NOTIFICATION_BUFFER: usize = 64;

pub struct IdeServerConfig {
   pub ide_name: String,
   pub server_version: String,
   pub lock_dir: PathBuf,
   pub workspace_folders: Vec<String>,
}

/// A running IDE server: a localhost WebSocket endpoint plus the lock file that advertises it.
/// Dropping it stops accepting connections, closes open ones, and removes the lock file.
pub struct IdeServer {
   port: u16,
   state: Arc<IdeState>,
   lock: Mutex<LockFile>,
   notifications: broadcast::Sender<String>,
   accept_task: JoinHandle<()>,
}

impl IdeServer {
   /// Binds a random free port on 127.0.0.1 and writes the lock file. Must run inside a Tokio
   /// runtime.
   pub async fn start(config: IdeServerConfig, host: Arc<dyn IdeHost>) -> io::Result<Self> {
      let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).await?;
      let port = listener.local_addr()?.port();
      let token = generate_auth_token()?;

      let lock = LockFile::create(
         &config.lock_dir,
         port,
         LockFileContent {
            pid: std::process::id(),
            workspace_folders: config.workspace_folders.clone(),
            ide_name: config.ide_name,
            transport: "ws".to_string(),
            auth_token: token.clone(),
         },
      )?;

      let state = Arc::new(IdeState::default());
      state.set_workspace_folders(config.workspace_folders);
      let handler = Arc::new(McpHandler::new(host, state.clone(), config.server_version));
      let (notifications, _) = broadcast::channel(NOTIFICATION_BUFFER);
      let accept_task = tokio::spawn(accept_loop(
         listener,
         Arc::<str>::from(token),
         handler,
         notifications.clone(),
      ));

      Ok(Self {
         port,
         state,
         lock: Mutex::new(lock),
         notifications,
         accept_task,
      })
   }

   pub fn port(&self) -> u16 {
      self.port
   }

   pub fn lock_path(&self) -> PathBuf {
      self.lock().path().to_path_buf()
   }

   /// The variables a terminal needs for `claude` to find this server on its own.
   pub fn terminal_env(&self) -> [(&'static str, String); 2] {
      [
         (PORT_ENV, self.port.to_string()),
         (ENABLE_ENV, "true".to_string()),
      ]
   }

   pub fn set_workspace_folders(&self, folders: Vec<String>) -> io::Result<()> {
      self.state.set_workspace_folders(folders.clone());
      self.lock().set_workspace_folders(folders)
   }

   /// Records the active editor's selection (None when no editor is active) and tells connected
   /// clients when it changed.
   pub fn update_selection(&self, selection: Option<EditorSelection>) {
      let params = selection.as_ref().map(EditorSelection::to_protocol);
      if self.state.update_selection(selection)
         && let Some(params) = params
      {
         self.broadcast("selection_changed", params);
      }
   }

   /// Sends a file range to Claude as context, as if the user had @-mentioned it. Lines are
   /// zero-based.
   pub fn at_mention(&self, file_path: &str, line_start: Option<u32>, line_end: Option<u32>) {
      let mut params = json!({ "filePath": file_path });
      if let Some(line) = line_start {
         params["lineStart"] = line.into();
      }
      if let Some(line) = line_end {
         params["lineEnd"] = line.into();
      }
      self.broadcast("at_mentioned", params);
   }

   pub fn has_clients(&self) -> bool {
      self.notifications.receiver_count() > 0
   }

   fn broadcast(&self, method: &str, params: Value) {
      let _ = self
         .notifications
         .send(notification(method, params).to_string());
   }

   fn lock(&self) -> std::sync::MutexGuard<'_, LockFile> {
      self
         .lock
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
   }
}

impl Drop for IdeServer {
   fn drop(&mut self) {
      self.accept_task.abort();
   }
}

async fn accept_loop(
   listener: TcpListener,
   token: Arc<str>,
   handler: Arc<McpHandler>,
   notifications: broadcast::Sender<String>,
) {
   let mut connections = JoinSet::new();
   loop {
      tokio::select! {
         accepted = listener.accept() => match accepted {
            Ok((stream, address)) if address.ip().is_loopback() => {
               connections.spawn(serve_connection(
                  stream,
                  token.clone(),
                  handler.clone(),
                  notifications.clone(),
               ));
            }
            Ok(_) => {}
            Err(error) => {
               log::warn!("Claude Code IDE server failed to accept a connection: {error}");
               tokio::time::sleep(Duration::from_millis(100)).await;
            }
         },
         Some(_) = connections.join_next(), if !connections.is_empty() => {}
      }
   }
}

#[allow(clippy::result_large_err)]
async fn serve_connection(
   stream: TcpStream,
   token: Arc<str>,
   handler: Arc<McpHandler>,
   notifications: broadcast::Sender<String>,
) {
   let authorize =
      |request: &Request, response: Response| answer_upgrade(request, response, &token);
   let socket = match accept_hdr_async(stream, authorize).await {
      Ok(socket) => socket,
      Err(error) => {
         log::debug!("Rejected a Claude Code IDE connection: {error}");
         return;
      }
   };
   log::info!("Claude Code connected to the IDE server");

   let (mut sink, mut source) = socket.split();
   let (replies, mut outgoing) = mpsc::unbounded_channel::<String>();
   if let Some(selection) = handler.latest_selection_notification() {
      let _ = replies.send(selection.to_string());
   }
   let mut notifications = notifications.subscribe();
   let writer = tokio::spawn(async move {
      let mut ping = tokio::time::interval(PING_INTERVAL);
      ping.tick().await;
      loop {
         let message = tokio::select! {
            reply = outgoing.recv() => match reply {
               Some(text) => Message::Text(text.into()),
               None => break,
            },
            notification = notifications.recv() => match notification {
               Ok(text) => Message::Text(text.into()),
               Err(broadcast::error::RecvError::Lagged(_)) => continue,
               Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = ping.tick() => Message::Ping(Vec::new().into()),
         };
         if sink.send(message).await.is_err() {
            break;
         }
      }
   });

   // Each request runs on its own task so a blocking `openDiff` does not hold up the rest.
   // Dropping the set when the socket closes aborts whatever is still waiting.
   let mut requests = JoinSet::new();
   while let Some(frame) = source.next().await {
      let text = match frame {
         Ok(Message::Text(text)) => text.to_string(),
         Ok(Message::Binary(bytes)) => match String::from_utf8(bytes.to_vec()) {
            Ok(text) => text,
            Err(_) => continue,
         },
         Ok(Message::Close(_)) | Err(_) => break,
         Ok(_) => continue,
      };
      let handler = handler.clone();
      let replies = replies.clone();
      requests.spawn(async move {
         if let Some(reply) = handler.handle_text(&text).await {
            let _ = replies.send(reply.to_string());
         }
      });
      while requests.try_join_next().is_some() {}
   }

   drop(requests);
   writer.abort();
   log::info!("Claude Code disconnected from the IDE server");
}

/// The handshake callback's signature is fixed by tungstenite, error response included.
#[allow(clippy::result_large_err)]
fn answer_upgrade(
   request: &Request,
   mut response: Response,
   token: &str,
) -> Result<Response, ErrorResponse> {
   match authorize_upgrade(request.headers(), token) {
      Ok(protocol) => {
         if let Some(protocol) = protocol {
            response
               .headers_mut()
               .insert(SEC_WEBSOCKET_PROTOCOL, protocol);
         }
         Ok(response)
      }
      Err(status) => {
         let mut rejection = ErrorResponse::new(Some("Unauthorized".to_string()));
         *rejection.status_mut() = status;
         Err(rejection)
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::{
      auth::AUTH_HEADER,
      host::{ToolError, ToolRequest},
      selection::SelectionPosition,
   };
   use async_trait::async_trait;
   use tokio_tungstenite::{
      WebSocketStream, client_async,
      tungstenite::{Error as WsError, client::IntoClientRequest, http::StatusCode},
   };

   struct EchoHost;

   #[async_trait]
   impl IdeHost for EchoHost {
      async fn call_tool(&self, tool: &str, arguments: Value) -> Result<Vec<String>, ToolError> {
         if tool == "openDiff" {
            std::future::pending::<()>().await;
         }
         Ok(vec![
            serde_json::to_string(&ToolRequest {
               request_id: String::new(),
               tool: tool.to_string(),
               arguments,
            })
            .unwrap(),
         ])
      }
   }

   async fn start_server(lock_dir: &std::path::Path) -> IdeServer {
      IdeServer::start(
         IdeServerConfig {
            ide_name: "Athas".to_string(),
            server_version: "0.0.0".to_string(),
            lock_dir: lock_dir.to_path_buf(),
            workspace_folders: vec!["/work/app".to_string()],
         },
         Arc::new(EchoHost),
      )
      .await
      .unwrap()
   }

   fn lock_token(server: &IdeServer) -> String {
      let lock: Value =
         serde_json::from_slice(&std::fs::read(server.lock_path()).unwrap()).unwrap();
      lock["authToken"].as_str().unwrap().to_string()
   }

   async fn connect(
      port: u16,
      token: Option<&str>,
   ) -> Result<WebSocketStream<TcpStream>, Box<WsError>> {
      let mut request = format!("ws://127.0.0.1:{port}")
         .into_client_request()
         .unwrap();
      request
         .headers_mut()
         .insert(SEC_WEBSOCKET_PROTOCOL, "mcp".parse().unwrap());
      if let Some(token) = token {
         request
            .headers_mut()
            .insert(AUTH_HEADER, token.parse().unwrap());
      }
      let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
      client_async(request, stream)
         .await
         .map(|(socket, response)| {
            assert_eq!(response.headers()[SEC_WEBSOCKET_PROTOCOL], "mcp");
            socket
         })
         .map_err(Box::new)
   }

   async fn next_json(socket: &mut WebSocketStream<TcpStream>) -> Value {
      loop {
         let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("timed out waiting for a frame")
            .unwrap()
            .unwrap();
         if let Message::Text(text) = frame {
            return serde_json::from_str(&text).unwrap();
         }
      }
   }

   async fn send_json(socket: &mut WebSocketStream<TcpStream>, value: Value) {
      socket
         .send(Message::Text(value.to_string().into()))
         .await
         .unwrap();
   }

   fn assert_unauthorized(result: Result<WebSocketStream<TcpStream>, Box<WsError>>) {
      match result.map_err(|error| *error) {
         Err(WsError::Http(response)) => assert_eq!(response.status(), StatusCode::UNAUTHORIZED),
         Err(other) => panic!("expected an HTTP 401 rejection, got {other:?}"),
         Ok(_) => panic!("the connection should have been rejected"),
      }
   }

   #[tokio::test]
   async fn rejects_connections_without_the_lock_file_token() {
      let dir = tempfile::tempdir().unwrap();
      let server = start_server(dir.path()).await;
      let token = lock_token(&server);

      assert_unauthorized(connect(server.port(), None).await);
      assert_unauthorized(connect(server.port(), Some("not-the-token")).await);
      let mut wrong = token.clone();
      wrong.replace_range(0..1, if token.starts_with('a') { "b" } else { "a" });
      assert_unauthorized(connect(server.port(), Some(&wrong)).await);
      assert!(connect(server.port(), Some(&token)).await.is_ok());
   }

   #[tokio::test]
   async fn lock_file_advertises_the_server_and_goes_away_with_it() {
      let dir = tempfile::tempdir().unwrap();
      let server = start_server(dir.path()).await;
      let path = server.lock_path();
      assert_eq!(path, dir.path().join(format!("{}.lock", server.port())));
      let lock: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
      assert_eq!(lock["ideName"], "Athas");
      assert_eq!(lock["transport"], "ws");
      assert_eq!(lock["pid"], std::process::id());
      assert_eq!(lock["workspaceFolders"], json!(["/work/app"]));
      assert_eq!(
         server.terminal_env(),
         [
            (PORT_ENV, server.port().to_string()),
            (ENABLE_ENV, "true".to_string())
         ]
      );

      server
         .set_workspace_folders(vec!["/work/other".to_string()])
         .unwrap();
      let lock: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
      assert_eq!(lock["workspaceFolders"], json!(["/work/other"]));

      drop(server);
      assert!(!path.exists());
   }

   #[tokio::test]
   async fn new_clients_get_the_latest_selection_first() {
      let dir = tempfile::tempdir().unwrap();
      let server = start_server(dir.path()).await;
      server.update_selection(Some(EditorSelection {
         file_path: "/work/app/a.rs".to_string(),
         text: String::new(),
         start: SelectionPosition {
            line: 2,
            character: 0,
         },
         end: SelectionPosition {
            line: 2,
            character: 0,
         },
      }));
      let token = lock_token(&server);
      let mut socket = connect(server.port(), Some(&token)).await.unwrap();
      let first = next_json(&mut socket).await;
      assert_eq!(first["method"], "selection_changed");
      assert_eq!(first["params"]["selection"]["isEmpty"], true);
   }

   #[tokio::test]
   async fn listens_on_loopback_only() {
      let dir = tempfile::tempdir().unwrap();
      let server = start_server(dir.path()).await;
      let lan = std::net::UdpSocket::bind("0.0.0.0:0")
         .and_then(|socket| {
            socket.connect("192.0.2.1:9")?;
            socket.local_addr()
         })
         .map(|address| address.ip())
         .ok()
         .filter(|ip| !ip.is_loopback() && !ip.is_unspecified());
      if let Some(ip) = lan {
         assert!(TcpStream::connect((ip, server.port())).await.is_err());
      }
   }

   #[tokio::test]
   async fn answers_requests_while_a_diff_is_pending_and_pushes_selections() {
      let dir = tempfile::tempdir().unwrap();
      let server = start_server(dir.path()).await;
      let token = lock_token(&server);
      let mut socket = connect(server.port(), Some(&token)).await.unwrap();

      send_json(
         &mut socket,
         json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
      )
      .await;
      assert_eq!(
         next_json(&mut socket).await["result"]["serverInfo"]["name"],
         "athas"
      );

      send_json(
         &mut socket,
         json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
               "name": "openDiff",
               "arguments": {
                  "old_file_path": "/a",
                  "new_file_path": "/a",
                  "new_file_contents": "x",
                  "tab_name": "t",
               },
            },
         }),
      )
      .await;
      send_json(
         &mut socket,
         json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "getOpenEditors", "arguments": {} },
         }),
      )
      .await;
      let reply = next_json(&mut socket).await;
      assert_eq!(reply["id"], 3);

      for _ in 0..100 {
         if server.has_clients() {
            break;
         }
         tokio::time::sleep(Duration::from_millis(5)).await;
      }
      server.update_selection(Some(EditorSelection {
         file_path: "/work/app/a.rs".to_string(),
         text: "x".to_string(),
         start: SelectionPosition {
            line: 0,
            character: 0,
         },
         end: SelectionPosition {
            line: 0,
            character: 1,
         },
      }));
      let pushed = next_json(&mut socket).await;
      assert_eq!(pushed["method"], "selection_changed");
      assert_eq!(pushed["params"]["text"], "x");
      assert!(pushed.get("id").is_none());

      server.at_mention("/work/app/a.rs", Some(1), Some(4));
      let mention = next_json(&mut socket).await;
      assert_eq!(mention["method"], "at_mentioned");
      assert_eq!(mention["params"]["lineEnd"], 4);

      server.at_mention("/work/app/b.rs", None, None);
      let whole_file = next_json(&mut socket).await;
      assert_eq!(
         whole_file["params"],
         json!({ "filePath": "/work/app/b.rs" })
      );
   }
}
