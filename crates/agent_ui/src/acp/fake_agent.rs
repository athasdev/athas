//! A scripted ACP agent for tests, adapted from Athas's `crates/ai/src/acp/fake_agent.rs`. It
//! answers each request from a script and records every message it received.
//!
//! The script maps a method name to a reply (`{ "result": ... }` or `{ "error": ... }`) or a list
//! of replies used in order, the last one repeating. Unscripted requests get `Method not found`.
//!
//! A reply may carry `"steps"` the agent takes before answering, in order:
//! - `{ "notify": method, "params": ... }` sends the client a notification;
//! - `{ "request": method, "params": ... }` sends the client a request and waits for its answer,
//!   which [`FakeAgent::answers`] records;
//! - `{ "await": method }` waits until the client sent a `method` message, such as
//!   `session/cancel`;
//! - `{ "hangup": true }` closes the connection, as a crashed agent does.

use std::{
    cell::RefCell,
    collections::HashMap,
    rc::Rc,
    sync::{Arc, Mutex},
};

use futures::{
    StreamExt,
    channel::{mpsc, oneshot},
    executor::LocalSpawner,
    task::LocalSpawnExt as _,
};
use serde_json::{Value, json};

use super::rpc::Transport;

#[derive(Clone, Default)]
pub struct FakeAgent {
    received: Arc<Mutex<Vec<Value>>>,
    answers: Arc<Mutex<Vec<Value>>>,
}

impl FakeAgent {
    /// The methods of every request and notification the agent received, in order.
    pub fn methods(&self) -> Vec<String> {
        self.received.lock().unwrap().iter().map(|message| message["method"].as_str().unwrap_or_default().to_string()).collect()
    }

    /// The params of every `method` message the agent received, in order.
    pub fn params(&self, method: &str) -> Vec<Value> {
        self.received.lock().unwrap().iter().filter(|message| message["method"] == method).map(|message| message["params"].clone()).collect()
    }

    /// The client's answers to the agent's `method` requests, in order.
    pub fn answers(&self, method: &str) -> Vec<Value> {
        self.answers.lock().unwrap().iter().filter(|answer| answer["method"] == method).map(|answer| answer["response"].clone()).collect()
    }
}

struct AgentSide {
    outgoing: RefCell<Option<mpsc::UnboundedSender<String>>>,
    record: FakeAgent,
    script: RefCell<HashMap<String, Value>>,
    waiting_answers: RefCell<HashMap<String, (String, oneshot::Sender<()>)>>,
    waiting_methods: RefCell<Vec<(String, oneshot::Sender<()>)>>,
    next_request_id: RefCell<u64>,
}

impl AgentSide {
    fn send(&self, message: Value) {
        if let Some(outgoing) = self.outgoing.borrow().as_ref() {
            let _ = outgoing.unbounded_send(message.to_string());
        }
    }

    fn next_reply(&self, method: &str) -> Value {
        let mut script = self.script.borrow_mut();
        match script.get_mut(method) {
            Some(Value::Array(replies)) if replies.len() > 1 => replies.remove(0),
            Some(Value::Array(replies)) => replies.first().cloned().unwrap_or(Value::Null),
            Some(reply) => reply.clone(),
            None => json!({ "error": { "code": -32601, "message": "Method not found" } }),
        }
    }

    fn received(&self, method: &str, params: Value) {
        self.record.received.lock().unwrap().push(json!({ "method": method, "params": params }));
        let mut waiting = self.waiting_methods.borrow_mut();
        let (done, still): (Vec<_>, Vec<_>) = waiting.drain(..).partition(|(awaited, _)| awaited == method);
        *waiting = still;
        for (_, done) in done {
            let _ = done.send(());
        }
    }

    fn answered(&self, message: Value) {
        let Some((method, done)) = self.waiting_answers.borrow_mut().remove(&message["id"].to_string()) else { return };
        self.record.answers.lock().unwrap().push(json!({ "method": method, "response": message }));
        let _ = done.send(());
    }

    async fn run_steps(&self, steps: Vec<Value>) {
        for step in steps {
            if let Some(method) = step.get("notify").and_then(Value::as_str) {
                self.send(json!({ "jsonrpc": "2.0", "method": method, "params": step["params"] }));
            } else if let Some(method) = step.get("request").and_then(Value::as_str) {
                let id = {
                    let mut next = self.next_request_id.borrow_mut();
                    *next += 1;
                    json!(*next)
                };
                let (done_tx, done_rx) = oneshot::channel();
                self.waiting_answers.borrow_mut().insert(id.to_string(), (method.to_string(), done_tx));
                self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": step["params"] }));
                let _ = done_rx.await;
            } else if let Some(method) = step.get("await").and_then(Value::as_str) {
                let already = self.record.methods().iter().any(|received| received == method);
                if !already {
                    let (tx, rx) = oneshot::channel();
                    self.waiting_methods.borrow_mut().push((method.to_string(), tx));
                    let _ = rx.await;
                }
            } else if step.get("hangup").is_some() {
                self.outgoing.borrow_mut().take();
            }
        }
    }
}

/// Starts a scripted agent on `spawner`; returns the client's end of the connection and the
/// agent's record of what it received.
pub fn fake_agent(script: Value, spawner: &LocalSpawner) -> (Transport, FakeAgent) {
    let (client, agent) = Transport::pair();
    let Transport { outgoing, mut incoming } = agent;
    let record = FakeAgent::default();
    let side = Rc::new(AgentSide {
        outgoing: RefCell::new(Some(outgoing)),
        record: record.clone(),
        script: RefCell::new(match script {
            Value::Object(map) => map.into_iter().collect(),
            _ => HashMap::new(),
        }),
        waiting_answers: RefCell::default(),
        waiting_methods: RefCell::default(),
        next_request_id: RefCell::new(1000),
    });
    let task_spawner = spawner.clone();
    spawner
        .spawn_local(async move {
            while let Some(line) = incoming.next().await {
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                let Some(method) = message.get("method").and_then(Value::as_str).map(str::to_string) else {
                    side.answered(message);
                    continue;
                };
                side.received(&method, message["params"].clone());
                let Some(id) = message.get("id").cloned() else { continue };
                let mut reply = side.next_reply(&method);
                let steps = match reply.as_object_mut().and_then(|reply| reply.remove("steps")) {
                    Some(Value::Array(steps)) => steps,
                    _ => Vec::new(),
                };
                reply["jsonrpc"] = json!("2.0");
                reply["id"] = id;
                let side = side.clone();
                task_spawner
                    .spawn_local(async move {
                        side.run_steps(steps).await;
                        side.send(reply);
                    })
                    .unwrap();
            }
        })
        .unwrap();
    (client, record)
}
