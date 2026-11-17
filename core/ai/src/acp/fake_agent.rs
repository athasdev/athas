//! An in-process ACP agent for tests. The client side is a real SDK connection; the agent side
//! answers each request from a script and records every message it received.
//!
//! The script maps a method name to a reply (`{ "result": ... }` or `{ "error": ... }`) or a list
//! of replies used in order, the last one repeating. Unscripted requests get `Method not found`.
//!
//! A reply may carry `"steps"` the agent takes before answering, in order:
//! - `{ "notify": method, "params": ... }` sends the client a notification, such as a
//!   `session/update`.
//! - `{ "request": method, "params": ... }` sends the client a request and waits for its answer,
//!   which [`FakeAgent::answers`] records. With `"id"` the request uses that JSON-RPC id, and with
//!   `"wait": false` the agent goes on without waiting.
//! - `{ "await": method }` waits until the client sent a `method` message, such as
//!   `session/cancel`.
//! - `{ "sleep_ms": n }` waits `n` milliseconds.
//! - `{ "hangup": true }` closes the connection, the way a crashed agent does; nothing is answered
//!   after it.

use super::AcpConnection;
use agent_client_protocol as acp_sdk;
use futures::{SinkExt, StreamExt, channel::mpsc};
use serde_json::{Value, json};
use std::{
   cell::{Cell, RefCell},
   collections::HashMap,
   rc::Rc,
   sync::{Arc, Mutex},
   time::Duration,
};
use tokio::sync::oneshot;

pub(super) struct FakeAgent {
   received: Arc<Mutex<Vec<Value>>>,
   // Only the unix-only worker tests read the client's answers.
   #[cfg(unix)]
   answers: Arc<Mutex<Vec<Value>>>,
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

   /// The client's answers to the agent's `method` requests, in order: the JSON-RPC response
   /// with its `result` or `error`.
   #[cfg(unix)]
   pub(super) fn answers(&self, method: &str) -> Vec<Value> {
      self
         .answers
         .lock()
         .unwrap()
         .iter()
         .filter(|answer| answer["method"] == method)
         .map(|answer| answer["response"].clone())
         .collect()
   }

   /// Waits until the client answered `count` of the agent's `method` requests.
   #[cfg(unix)]
   pub(super) async fn wait_for_answers(&self, method: &str, count: usize) -> Vec<Value> {
      wait_until(|| self.answers(method).len() >= count).await;
      self.answers(method)
   }
}

async fn wait_until(done: impl Fn() -> bool) {
   let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
   while !done() {
      assert!(
         tokio::time::Instant::now() < deadline,
         "the fake agent waited too long"
      );
      tokio::time::sleep(Duration::from_millis(2)).await;
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

/// The agent side of the connection, shared by the reader and the replies that take steps.
struct AgentSide {
   outgoing: RefCell<Option<mpsc::UnboundedSender<String>>>,
   received: Arc<Mutex<Vec<Value>>>,
   answers: Arc<Mutex<Vec<Value>>>,
   waiting: RefCell<HashMap<String, (String, oneshot::Sender<()>)>>,
   next_request_id: Cell<u64>,
}

impl AgentSide {
   fn send(&self, message: Value) {
      if let Some(outgoing) = self.outgoing.borrow().as_ref() {
         let _ = outgoing.unbounded_send(message.to_string());
      }
   }

   fn has_received(&self, method: &str) -> bool {
      self
         .received
         .lock()
         .unwrap()
         .iter()
         .any(|message| message["method"] == method)
   }

   /// Records the client's answer to one of the agent's requests.
   fn answered(&self, message: Value) {
      let key = message["id"].to_string();
      let Some((method, done)) = self.waiting.borrow_mut().remove(&key) else {
         return;
      };
      self
         .answers
         .lock()
         .unwrap()
         .push(json!({ "method": method, "response": message }));
      let _ = done.send(());
   }

   async fn run_steps(&self, steps: Vec<Value>) {
      for step in steps {
         if let Some(method) = step.get("notify").and_then(Value::as_str) {
            self.send(json!({ "jsonrpc": "2.0", "method": method, "params": step["params"] }));
         } else if let Some(method) = step.get("request").and_then(Value::as_str) {
            let id = step.get("id").cloned().unwrap_or_else(|| {
               let id = self.next_request_id.get();
               self.next_request_id.set(id + 1);
               json!(id)
            });
            let (done_tx, done_rx) = oneshot::channel();
            self
               .waiting
               .borrow_mut()
               .insert(id.to_string(), (method.to_string(), done_tx));
            self.send(json!({
               "jsonrpc": "2.0",
               "id": id,
               "method": method,
               "params": step["params"],
            }));
            if step.get("wait") != Some(&json!(false)) {
               let _ = done_rx.await;
            }
         } else if let Some(method) = step.get("await").and_then(Value::as_str) {
            wait_until(|| self.has_received(method)).await;
         } else if let Some(millis) = step.get("sleep_ms").and_then(Value::as_u64) {
            tokio::time::sleep(Duration::from_millis(millis)).await;
         } else if step.get("hangup").is_some() {
            self.outgoing.borrow_mut().take();
         }
      }
   }
}

/// The client side of a connection to a scripted agent: hand it to `connect_with` or
/// `serve_client`. Must be used inside a `LocalSet`.
pub(super) fn fake_agent_transport(
   script: Value,
) -> (
   impl acp_sdk::ConnectTo<acp_sdk::Client> + 'static,
   FakeAgent,
) {
   let mut script: HashMap<String, Value> = match script {
      Value::Object(map) => map.into_iter().collect(),
      _ => HashMap::new(),
   };
   let (client_tx, mut agent_rx) = mpsc::unbounded::<String>();
   let (agent_tx, client_rx) = mpsc::unbounded::<String>();
   let received = Arc::new(Mutex::new(Vec::new()));
   let answers = Arc::new(Mutex::new(Vec::new()));
   let agent = Rc::new(AgentSide {
      outgoing: RefCell::new(Some(agent_tx)),
      received: Arc::clone(&received),
      answers: Arc::clone(&answers),
      waiting: RefCell::default(),
      next_request_id: Cell::new(1000),
   });

   tokio::task::spawn_local(async move {
      while let Some(line) = agent_rx.next().await {
         let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
         };
         let Some(method) = message.get("method").and_then(Value::as_str) else {
            agent.answered(message);
            continue;
         };
         agent
            .received
            .lock()
            .unwrap()
            .push(json!({ "method": method, "params": message["params"] }));
         let Some(id) = message.get("id").cloned() else {
            continue;
         };
         let mut reply = next_reply(&mut script, method);
         let steps = match reply
            .as_object_mut()
            .and_then(|reply| reply.remove("steps"))
         {
            Some(Value::Array(steps)) => steps,
            _ => Vec::new(),
         };
         reply["jsonrpc"] = json!("2.0");
         reply["id"] = id;
         if steps.is_empty() {
            agent.send(reply);
            continue;
         }
         let agent = Rc::clone(&agent);
         tokio::task::spawn_local(async move {
            agent.run_steps(steps).await;
            agent.send(reply);
         });
      }
   });

   let transport = acp_sdk::Lines::new(
      client_tx.sink_map_err(std::io::Error::other),
      client_rx.map(Ok::<_, std::io::Error>),
   );
   (
      transport,
      FakeAgent {
         received,
         #[cfg(unix)]
         answers,
      },
   )
}

/// Connects a client to a scripted agent. Must run inside a `LocalSet`.
pub(super) async fn connect_fake_agent(script: Value) -> (Arc<AcpConnection>, FakeAgent) {
   let (transport, agent) = fake_agent_transport(script);
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
   (Arc::new(connection), agent)
}
