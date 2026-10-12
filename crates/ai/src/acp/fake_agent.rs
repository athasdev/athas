//! An in-process ACP agent for tests. The client side is a real SDK connection; the agent side
//! answers each request from a script and records every message it received.
//!
//! The script maps a method name to a reply (`{ "result": ... }` or `{ "error": ... }`) or a list
//! of replies used in order, the last one repeating. Unscripted requests get `Method not found`.

use super::AcpConnection;
use agent_client_protocol as acp_sdk;
use futures::{SinkExt, StreamExt, channel::mpsc};
use serde_json::{Value, json};
use std::{
   collections::HashMap,
   sync::{Arc, Mutex},
};

pub(super) struct FakeAgent {
   received: Arc<Mutex<Vec<Value>>>,
}

impl FakeAgent {
   /// The methods of every request and notification the agent received, in order.
   pub(super) fn methods(&self) -> Vec<String> {
      self
         .received
         .lock()
         .unwrap()
         .iter()
         .map(|message| message["method"].as_str().unwrap_or_default().to_string())
         .collect()
   }

   /// The params of every `method` message the agent received, in order.
   pub(super) fn params(&self, method: &str) -> Vec<Value> {
      self
         .received
         .lock()
         .unwrap()
         .iter()
         .filter(|message| message["method"] == method)
         .map(|message| message["params"].clone())
         .collect()
   }
}

fn next_reply(script: &mut HashMap<String, Value>, method: &str) -> Value {
   match script.get_mut(method) {
      Some(Value::Array(replies)) if replies.len() > 1 => replies.remove(0),
      Some(Value::Array(replies)) => replies.first().cloned().unwrap_or(Value::Null),
      Some(reply) => reply.clone(),
      None => json!({ "error": { "code": -32601, "message": "Method not found" } }),
   }
}

/// Connects a client to a scripted agent. Must run inside a `LocalSet`.
pub(super) async fn connect_fake_agent(script: Value) -> (Arc<AcpConnection>, FakeAgent) {
   let mut script: HashMap<String, Value> = match script {
      Value::Object(map) => map.into_iter().collect(),
      _ => HashMap::new(),
   };
   let (client_tx, mut agent_rx) = mpsc::unbounded::<String>();
   let (agent_tx, client_rx) = mpsc::unbounded::<String>();
   let received = Arc::new(Mutex::new(Vec::new()));

   let log = Arc::clone(&received);
   tokio::task::spawn_local(async move {
      while let Some(line) = agent_rx.next().await {
         let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
         };
         let Some(method) = message.get("method").and_then(Value::as_str) else {
            continue;
         };
         log.lock()
            .unwrap()
            .push(json!({ "method": method, "params": message["params"] }));
         let Some(id) = message.get("id").cloned() else {
            continue;
         };
         let mut reply = next_reply(&mut script, method);
         reply["jsonrpc"] = json!("2.0");
         reply["id"] = id;
         let _ = agent_tx.unbounded_send(reply.to_string());
      }
   });

   let transport = acp_sdk::Lines::new(
      client_tx.sink_map_err(std::io::Error::other),
      client_rx.map(Ok::<_, std::io::Error>),
   );
   let (connection_tx, connection_rx) = tokio::sync::oneshot::channel();
   tokio::task::spawn_local(async move {
      let _ = acp_sdk::Client
         .builder()
         .connect_with(transport, async move |connection: AcpConnection| {
            let _ = connection_tx.send(connection);
            std::future::pending::<acp_sdk::Result<()>>().await
         })
         .await;
   });

   let connection = connection_rx.await.expect("fake agent connection");
   (Arc::new(connection), FakeAgent { received })
}
