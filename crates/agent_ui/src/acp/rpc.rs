//! JSON-RPC 2.0 over newline-delimited messages, the framing ACP uses on an agent's stdio.
//!
//! The connection only sees lines: a process's pipes, an in-memory fake agent in tests, or a
//! socket to a remote agent all plug in as a [`Transport`].

use std::{
    collections::HashMap,
    fmt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
    },
};

use futures::{
    StreamExt,
    channel::{mpsc, oneshot},
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

/// The two directions of a connection to an agent, one JSON-RPC message per line.
pub struct Transport {
    pub outgoing: mpsc::UnboundedSender<String>,
    pub incoming: mpsc::UnboundedReceiver<String>,
}

impl Transport {
    /// Two connected ends: what one side sends, the other receives.
    pub fn pair() -> (Transport, Transport) {
        let (a_tx, a_rx) = mpsc::unbounded();
        let (b_tx, b_rx) = mpsc::unbounded();
        (Transport { outgoing: a_tx, incoming: b_rx }, Transport { outgoing: b_tx, incoming: a_rx })
    }
}

/// A JSON-RPC error, from the agent or for it.
#[derive(Clone, Debug, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl RpcError {
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL: i64 = -32603;
    /// ACP's "authentication required".
    pub const AUTH_REQUIRED: i64 = -32000;
    /// ACP's "resource not found", such as a session the agent no longer has.
    pub const RESOURCE_NOT_FOUND: i64 = -32002;
    /// The connection closed before an answer came; not a JSON-RPC code.
    pub const DISCONNECTED: i64 = -1;

    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), data: None }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self::new(Self::METHOD_NOT_FOUND, format!("Method not found: {method}"))
    }

    pub fn invalid_params(error: impl fmt::Display) -> Self {
        Self::new(Self::INVALID_PARAMS, format!("Invalid params: {error}"))
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(Self::INTERNAL, message)
    }

    fn from_value(value: &Value) -> Self {
        Self {
            code: value.get("code").and_then(Value::as_i64).unwrap_or(Self::INTERNAL),
            message: value.get("message").and_then(Value::as_str).unwrap_or("Unknown error").to_string(),
            data: value.get("data").cloned(),
        }
    }

    fn to_value(&self) -> Value {
        let mut value = json!({ "code": self.code, "message": self.message });
        if let Some(data) = &self.data {
            value["data"] = data.clone();
        }
        value
    }
}

impl fmt::Display for RpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Agents put the useful part (such as a stack-free reason) in `data.details` or `data`.
        let detail = self
            .data
            .as_ref()
            .and_then(|data| data.get("details").and_then(Value::as_str).or_else(|| data.as_str()));
        match detail {
            Some(detail) if !detail.is_empty() && detail != self.message => write!(f, "{}: {detail}", self.message),
            _ => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for RpcError {}

/// A message from the agent: a request that wants an answer, a notification, or the answer to
/// one of our requests. All three come through one queue so they stay in the order the agent
/// sent them; whoever reads it hands answers back with [`RpcConnection::resolve`].
#[derive(Debug)]
pub enum Incoming {
    Request { id: Value, method: String, params: Value },
    Notification { method: String, params: Value },
    Response { id: i64, result: Result<Value, RpcError> },
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, RpcError>>>>>;

/// The client end of a JSON-RPC connection.
pub struct RpcConnection {
    outgoing: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: AtomicI64,
    /// When a message last went either way.
    last_activity: Arc<Mutex<web_time::Instant>>,
}

impl RpcConnection {
    /// Starts a connection over `transport`. Messages from the agent arrive on the returned
    /// receiver; the returned future reads the transport and must be polled for anything to
    /// arrive. It ends when the agent closes its side, and the receiver then ends too.
    pub fn new(
        transport: Transport,
    ) -> (Arc<Self>, mpsc::UnboundedReceiver<Incoming>, impl Future<Output = ()> + Send + 'static) {
        let Transport { outgoing, mut incoming } = transport;
        let last_activity = Arc::new(Mutex::new(web_time::Instant::now()));
        let connection = Arc::new(Self { outgoing, pending: Pending::default(), next_id: AtomicI64::new(0), last_activity: last_activity.clone() });
        let (incoming_tx, incoming_rx) = mpsc::unbounded();
        let writer = connection.outgoing.clone();
        let reader = async move {
            while let Some(line) = incoming.next().await {
                *last_activity.lock().unwrap_or_else(|p| p.into_inner()) = web_time::Instant::now();
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let Ok(message) = serde_json::from_str::<Value>(line) else {
                    // Agents sometimes log to stdout; anything that is not JSON is not for us.
                    continue;
                };
                route(message, &incoming_tx, &writer);
            }
        };
        (connection, incoming_rx, reader)
    }

    /// Sends a request and waits for its answer.
    pub async fn request<P: Serialize, R: DeserializeOwned>(&self, method: &str, params: P) -> Result<R, RpcError> {
        let value = self.request_value(method, serde_json::to_value(params).map_err(RpcError::invalid_params)?).await?;
        serde_json::from_value(value).map_err(|error| RpcError::internal(format!("Unexpected answer to {method}: {error}")))
    }

    pub async fn request_value(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let (_, answer) = self.start_request(method, params);
        answer.await
    }

    /// Sends a request; returns its id and the answer to wait for.
    pub fn start_request(&self, method: &str, params: Value) -> (i64, impl Future<Output = Result<Value, RpcError>> + use<>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.touch();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap_or_else(|p| p.into_inner()).insert(id, tx);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let sent = self.outgoing.unbounded_send(message.to_string()).is_ok();
        if !sent {
            self.pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
        }
        let answer = async move {
            if !sent {
                return Err(RpcError::new(RpcError::DISCONNECTED, "The agent is not running"));
            }
            rx.await.unwrap_or_else(|_| Err(RpcError::new(RpcError::DISCONNECTED, "The agent closed the connection")))
        };
        (id, answer)
    }

    /// Hands the agent's answer to the request waiting for it.
    pub fn resolve(&self, id: i64, result: Result<Value, RpcError>) {
        if let Some(waiter) = self.pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&id) {
            let _ = waiter.send(result);
        }
    }

    pub fn notify<P: Serialize>(&self, method: &str, params: P) {
        let params = serde_json::to_value(params).unwrap_or(Value::Null);
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let _ = self.outgoing.unbounded_send(message.to_string());
    }

    /// Answers a request the agent sent.
    pub fn respond(&self, id: Value, result: Result<Value, RpcError>) {
        self.touch();
        let _ = self.outgoing.unbounded_send(response(id, result).to_string());
    }

    fn touch(&self) {
        *self.last_activity.lock().unwrap_or_else(|p| p.into_inner()) = web_time::Instant::now();
    }

    /// How long since a message last went either way.
    pub fn idle_for(&self) -> std::time::Duration {
        self.last_activity.lock().unwrap_or_else(|p| p.into_inner()).elapsed()
    }

    /// Whether a request still waits for the agent's answer.
    pub fn has_pending(&self) -> bool {
        !self.pending.lock().unwrap_or_else(|p| p.into_inner()).is_empty()
    }

    /// Fails every request still waiting; for once the agent's messages have all been read.
    pub fn fail_pending(&self) {
        for (_, waiter) in self.pending.lock().unwrap_or_else(|p| p.into_inner()).drain() {
            let _ = waiter.send(Err(RpcError::new(RpcError::DISCONNECTED, "The agent closed the connection")));
        }
    }

    /// Stops sending: the agent sees its stdin close.
    pub fn close(&self) {
        self.outgoing.close_channel();
    }
}

fn response(id: Value, result: Result<Value, RpcError>) -> Value {
    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error.to_value() }),
    }
}

fn route(message: Value, incoming: &mpsc::UnboundedSender<Incoming>, writer: &mpsc::UnboundedSender<String>) {
    let method = message.get("method").and_then(Value::as_str).map(str::to_string);
    let id = message.get("id").filter(|id| !id.is_null()).cloned();
    match (method, id) {
        (Some(method), Some(id)) => {
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            if incoming.unbounded_send(Incoming::Request { id: id.clone(), method: method.clone(), params }).is_err() {
                let _ = writer.unbounded_send(response(id, Err(RpcError::method_not_found(&method))).to_string());
            }
        }
        (Some(method), None) => {
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            let _ = incoming.unbounded_send(Incoming::Notification { method, params });
        }
        (None, Some(id)) => {
            let Some(id) = id.as_i64() else { return };
            let result = match message.get("error") {
                Some(error) => Err(RpcError::from_value(error)),
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = incoming.unbounded_send(Incoming::Response { id, result });
        }
        (None, None) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::{executor::block_on, future::join};

    /// Hands answers back until the agent hangs up, as the ACP client's dispatcher does.
    async fn resolve_answers(connection: Arc<RpcConnection>, mut incoming: mpsc::UnboundedReceiver<Incoming>) {
        while let Some(message) = incoming.next().await {
            if let Incoming::Response { id, result } = message {
                connection.resolve(id, result);
            }
        }
        connection.fail_pending();
    }

    #[test]
    fn a_waiting_request_keeps_the_connection_busy() {
        let (client, _agent) = Transport::pair();
        let (connection, _incoming, _reader) = RpcConnection::new(client);
        let (id, _answer) = connection.start_request("session/prompt", json!({}));
        assert!(connection.has_pending());
        assert!(connection.idle_for() < std::time::Duration::from_secs(5));
        connection.resolve(id, Ok(Value::Null));
        assert!(!connection.has_pending());
    }

    #[test]
    fn answers_reach_the_request_that_asked() {
        let (client, mut agent) = Transport::pair();
        let (connection, incoming, reader) = RpcConnection::new(client);
        let answers = resolve_answers(connection.clone(), incoming);
        let agent_side = async move {
            for _ in 0..2 {
                let line = agent.incoming.next().await.unwrap();
                let message: Value = serde_json::from_str(&line).unwrap();
                let reply = if message["method"] == "fails" {
                    json!({ "jsonrpc": "2.0", "id": message["id"], "error": { "code": -32000, "message": "Sign in" } })
                } else {
                    json!({ "jsonrpc": "2.0", "id": message["id"], "result": { "echo": message["params"] } })
                };
                agent.outgoing.unbounded_send(reply.to_string()).unwrap();
            }
            drop(agent);
        };
        let requests = async {
            let ok: Value = connection.request("echo", json!({ "a": 1 })).await.unwrap();
            assert_eq!(ok, json!({ "echo": { "a": 1 } }));
            let error = connection.request::<_, Value>("fails", json!({})).await.unwrap_err();
            assert_eq!(error.code, RpcError::AUTH_REQUIRED);
            assert_eq!(error.message, "Sign in");
        };
        block_on(join(join(reader, agent_side), join(answers, requests)));
    }

    #[test]
    fn requests_fail_when_the_agent_hangs_up() {
        let (client, agent) = Transport::pair();
        let (connection, incoming, reader) = RpcConnection::new(client);
        let request = connection.request::<_, Value>("never", json!({}));
        drop(agent);
        let (_, (_, result)) = block_on(join(reader, join(resolve_answers(connection.clone(), incoming), request)));
        assert_eq!(result.unwrap_err().code, RpcError::DISCONNECTED);
    }

    #[test]
    fn requests_and_notifications_from_the_agent_are_handed_over() {
        let (client, agent) = Transport::pair();
        let (_connection, mut incoming, reader) = RpcConnection::new(client);
        agent.outgoing.unbounded_send("not json, a log line".into()).unwrap();
        agent
            .outgoing
            .unbounded_send(json!({ "jsonrpc": "2.0", "id": 7, "method": "fs/read_text_file", "params": {} }).to_string())
            .unwrap();
        agent.outgoing.unbounded_send(json!({ "jsonrpc": "2.0", "method": "session/update", "params": {} }).to_string()).unwrap();
        drop(agent);
        block_on(reader);
        let first = block_on(incoming.next()).unwrap();
        assert!(matches!(first, Incoming::Request { ref method, .. } if method == "fs/read_text_file"));
        let second = block_on(incoming.next()).unwrap();
        assert!(matches!(second, Incoming::Notification { ref method, .. } if method == "session/update"));
    }
}
