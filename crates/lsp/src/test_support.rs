//! A scripted language server for tests.
//!
//! The crate's own test binary doubles as the server: `spawn_fake_server`
//! re-runs the current executable filtered down to `fake_lsp_server_entry`
//! with an environment flag set, and that test then speaks LSP over stdio
//! instead of returning. This keeps the tests cross-platform without relying
//! on any external language server or scripting tool.

use crate::client::{LspClient, LspServerEnv};
use lsp_types::Url;
use serde_json::{Value, json};
use std::{
   collections::HashMap,
   io::{BufRead, BufReader, Write},
   path::Path,
   process::Child,
   thread,
   time::Duration,
};

const FAKE_SERVER_ENV: &str = "ATHAS_LSP_FAKE_SERVER";

pub(crate) struct FakeServer {
   pub client: LspClient,
   pub child: Child,
}

impl FakeServer {
   pub fn kill(&mut self) {
      let _ = self.child.kill();
      let _ = self.child.wait();
   }
}

impl Drop for FakeServer {
   fn drop(&mut self) {
      self.kill();
   }
}

pub(crate) async fn spawn_fake_server(workspace: &Path) -> (LspClient, Child) {
   let exe = std::env::current_exe().expect("test executable path");
   let mut env = LspServerEnv::new();
   env.insert(FAKE_SERVER_ENV.to_string(), "1".to_string());

   LspClient::start(
      exe,
      vec![
         "--exact".to_string(),
         "test_support::fake_lsp_server_entry".to_string(),
         "--nocapture".to_string(),
         "--test-threads=1".to_string(),
         "--quiet".to_string(),
      ],
      Url::from_file_path(workspace).unwrap(),
      None,
      Some(workspace.to_path_buf()),
      env,
   )
   .await
   .expect("fake language server should start")
}

pub(crate) async fn start_fake_server(workspace: &Path) -> FakeServer {
   let (client, child) = spawn_fake_server(workspace).await;
   FakeServer { client, child }
}

fn read_message(reader: &mut impl BufRead) -> Option<Value> {
   let mut content_length = None;
   loop {
      let mut line = String::new();
      if reader.read_line(&mut line).ok()? == 0 {
         return None;
      }
      let line = line.trim_end();
      if line.is_empty() {
         break;
      }
      if let Some(value) = line.strip_prefix("Content-Length: ") {
         content_length = value.parse::<usize>().ok();
      }
   }

   let mut body = vec![0; content_length?];
   reader.read_exact(&mut body).ok()?;
   serde_json::from_slice(&body).ok()
}

fn write_raw(bytes: &[u8]) {
   let mut stdout = std::io::stdout().lock();
   stdout.write_all(bytes).unwrap();
   stdout.flush().unwrap();
}

fn write_message(message: &Value) {
   let body = message.to_string();
   write_raw(format!("Content-Length: {}\r\n\r\n{}", body.len(), body).as_bytes());
}

/// Writes a message with an extra header, split into small chunks with
/// pauses so the client has to reassemble partial reads.
fn write_fragmented(message: &Value) {
   let body = message.to_string();
   let framed = format!(
      "Content-Length: {}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}",
      body.len(),
      body
   );
   for chunk in framed.as_bytes().chunks(7) {
      write_raw(chunk);
      thread::sleep(Duration::from_millis(2));
   }
}

/// Writes a message whose headers use unusual casing, ordering, and spacing.
fn write_loose_headers(message: &Value) {
   let body = message.to_string();
   write_raw(
      format!(
         "X-Fake-Trace: 1\r\ncontent-length:  {} \
          \r\nCONTENT-TYPE:application/vscode-jsonrpc\r\n\r\n{}",
         body.len(),
         body
      )
      .as_bytes(),
   );
}

fn result(id: &Value, result: Value) -> Value {
   json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn run_fake_server() -> ! {
   let mut reader = BufReader::new(std::io::stdin().lock());
   let mut held_reverse: Option<Value> = None;
   let mut pending_server_requests: HashMap<String, Value> = HashMap::new();
   let mut capabilities = json!({});

   while let Some(message) = read_message(&mut reader) {
      let method = message.get("method").and_then(Value::as_str);
      let id = message.get("id").cloned();

      match (method, id) {
         (Some("initialize"), Some(id)) => {
            let options = &message["params"]["initializationOptions"];
            if let Some(caps) = options.get("fakeCapabilities") {
               capabilities = caps.clone();
            }
            write_message(&result(
               &id,
               json!({ "capabilities": capabilities, "serverInfo": { "name": "fake" } }),
            ));
         }
         (Some("initialized"), None) => {
            write_message(&json!({
               "jsonrpc": "2.0",
               "method": "window/logMessage",
               "params": { "type": 3, "message": "fake server ready" }
            }));
         }
         (Some("test/echo"), Some(id)) => write_message(&result(&id, message["params"].clone())),
         (Some("test/fragmented"), Some(id)) => {
            write_fragmented(&result(&id, message["params"].clone()))
         }
         (Some("test/looseHeaders"), Some(id)) => {
            write_loose_headers(&result(&id, message["params"].clone()))
         }
         (Some("test/error"), Some(id)) => write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": "Method not found" }
         })),
         (Some("test/reverse"), Some(id)) => match held_reverse.take() {
            None => held_reverse = Some(message),
            Some(first) => {
               write_message(&result(&id, message["params"].clone()));
               write_message(&result(&first["id"], first["params"].clone()));
            }
         },
         (Some("test/serverRequest"), Some(id)) => {
            let server_request_id = format!("srv-{}", pending_server_requests.len() + 1);
            write_message(&json!({
               "jsonrpc": "2.0",
               "id": server_request_id,
               "method": message["params"]["method"],
               "params": message["params"]["params"],
            }));
            pending_server_requests.insert(server_request_id, id);
         }
         (Some("test/crash"), Some(_)) => std::process::exit(3),
         (Some("exit"), None) => std::process::exit(0),
         (None, Some(server_request_id)) => {
            let key = server_request_id.as_str().unwrap_or_default().to_string();
            if let Some(original_id) = pending_server_requests.remove(&key) {
               write_message(&result(&original_id, message));
            }
         }
         _ => {}
      }
   }

   std::process::exit(0)
}

#[test]
fn fake_lsp_server_entry() {
   if std::env::var_os(FAKE_SERVER_ENV).is_some() {
      run_fake_server();
   }
}
