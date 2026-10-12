use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
   collections::HashMap,
   sync::{
      Arc, Mutex,
      atomic::{AtomicU64, Ordering},
   },
   time::Duration,
};
use tokio::sync::oneshot;

/// Why a tool call failed, mapped onto a JSON-RPC error by the protocol layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolError {
   InvalidParams(String),
   Failed(String),
   /// No editor window answered, or the answer took too long.
   Unavailable,
}

/// The editor side of the integration: the tools Claude calls that need the editor's state.
#[async_trait]
pub trait IdeHost: Send + Sync {
   /// Runs `tool` and returns the text items of its MCP result.
   async fn call_tool(&self, tool: &str, arguments: Value) -> Result<Vec<String>, ToolError>;
}

/// Sent to the frontend: run `tool` with `arguments` and answer under `request_id`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequest {
   pub request_id: String,
   pub tool: String,
   pub arguments: Value,
}

/// What the frontend answers a [`ToolRequest`] with: the text items of the result, or an error.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnswer {
   pub content: Vec<String>,
   pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BridgeEvent {
   Request(ToolRequest),
   /// Claude went away before the frontend answered; drop any UI the request opened.
   Cancel {
      request_id: String,
   },
}

pub type BridgeEmitter = dyn Fn(&BridgeEvent) -> Result<(), String> + Send + Sync;

/// Forwards tool calls to the frontend as events and waits for its answer.
pub struct FrontendBridge {
   emit: Box<BridgeEmitter>,
   pending: Arc<Mutex<HashMap<String, oneshot::Sender<ToolAnswer>>>>,
   next_id: AtomicU64,
   timeout: Duration,
}

/// Tools that wait on the user instead of answering right away.
const BLOCKING_TOOLS: &[&str] = &["openDiff"];

impl FrontendBridge {
   pub fn new(timeout: Duration, emit: Box<BridgeEmitter>) -> Self {
      Self {
         emit,
         pending: Arc::default(),
         next_id: AtomicU64::new(1),
         timeout,
      }
   }

   /// Hands the frontend's answer to the waiting call. Returns false when nothing waits on
   /// `request_id`, such as a second window answering the same request.
   pub fn respond(&self, request_id: &str, answer: ToolAnswer) -> bool {
      let sender = self
         .pending
         .lock()
         .ok()
         .and_then(|mut pending| pending.remove(request_id));
      sender.is_some_and(|sender| sender.send(answer).is_ok())
   }

   pub fn pending_count(&self) -> usize {
      self
         .pending
         .lock()
         .map(|pending| pending.len())
         .unwrap_or(0)
   }
}

/// Removes its request from the pending map when the call ends, however it ends. A call dropped
/// before an answer arrived (Claude disconnected) also tells the frontend to cancel it.
struct PendingGuard<'a> {
   bridge: &'a FrontendBridge,
   request_id: String,
   answered: bool,
}

impl Drop for PendingGuard<'_> {
   fn drop(&mut self) {
      let was_pending = self
         .bridge
         .pending
         .lock()
         .ok()
         .and_then(|mut pending| pending.remove(&self.request_id))
         .is_some();
      if was_pending && !self.answered {
         let _ = (self.bridge.emit)(&BridgeEvent::Cancel {
            request_id: self.request_id.clone(),
         });
      }
   }
}

#[async_trait]
impl IdeHost for FrontendBridge {
   async fn call_tool(&self, tool: &str, arguments: Value) -> Result<Vec<String>, ToolError> {
      let request_id = format!(
         "claude-ide-{}",
         self.next_id.fetch_add(1, Ordering::Relaxed)
      );
      let (sender, receiver) = oneshot::channel();
      self
         .pending
         .lock()
         .map_err(|_| ToolError::Unavailable)?
         .insert(request_id.clone(), sender);
      let mut guard = PendingGuard {
         bridge: self,
         request_id: request_id.clone(),
         answered: false,
      };

      let request = BridgeEvent::Request(ToolRequest {
         request_id,
         tool: tool.to_string(),
         arguments,
      });
      if let Err(error) = (self.emit)(&request) {
         log::warn!("Failed to send Claude Code tool call {tool} to the editor: {error}");
         guard.answered = true;
         return Err(ToolError::Unavailable);
      }

      let answer = if BLOCKING_TOOLS.contains(&tool) {
         receiver.await.map_err(|_| ToolError::Unavailable)
      } else {
         match tokio::time::timeout(self.timeout, receiver).await {
            Ok(answer) => answer.map_err(|_| ToolError::Unavailable),
            Err(_) => {
               guard.answered = true;
               Err(ToolError::Unavailable)
            }
         }
      };
      guard.answered = true;
      let answer = answer?;
      match answer.error {
         Some(message) => Err(ToolError::Failed(message)),
         None => Ok(answer.content),
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   fn recording_bridge(timeout: Duration) -> (Arc<FrontendBridge>, Arc<Mutex<Vec<BridgeEvent>>>) {
      let events = Arc::new(Mutex::new(Vec::new()));
      let sink = events.clone();
      let bridge = FrontendBridge::new(
         timeout,
         Box::new(move |event| {
            sink.lock().unwrap().push(event.clone());
            Ok(())
         }),
      );
      (Arc::new(bridge), events)
   }

   async fn wait_for_request(events: &Mutex<Vec<BridgeEvent>>) -> ToolRequest {
      for _ in 0..100 {
         if let Some(BridgeEvent::Request(request)) = events.lock().unwrap().first().cloned() {
            return request;
         }
         tokio::time::sleep(Duration::from_millis(5)).await;
      }
      panic!("no request was emitted");
   }

   #[tokio::test]
   async fn forwards_the_call_and_returns_the_answer() {
      let (bridge, events) = recording_bridge(Duration::from_secs(5));
      let call = {
         let bridge = bridge.clone();
         tokio::spawn(async move {
            bridge
               .call_tool("getOpenEditors", serde_json::json!({}))
               .await
         })
      };

      let request = wait_for_request(&events).await;
      assert_eq!(request.tool, "getOpenEditors");
      assert!(bridge.respond(
         &request.request_id,
         ToolAnswer {
            content: vec!["{\"tabs\":[]}".to_string()],
            error: None,
         },
      ));
      assert_eq!(call.await.unwrap(), Ok(vec!["{\"tabs\":[]}".to_string()]));
      assert_eq!(bridge.pending_count(), 0);
      assert!(!bridge.respond(&request.request_id, ToolAnswer::default()));
   }

   #[tokio::test]
   async fn frontend_errors_become_tool_failures() {
      let (bridge, events) = recording_bridge(Duration::from_secs(5));
      let call = {
         let bridge = bridge.clone();
         tokio::spawn(async move { bridge.call_tool("saveDocument", Value::Null).await })
      };
      let request = wait_for_request(&events).await;
      bridge.respond(
         &request.request_id,
         ToolAnswer {
            content: Vec::new(),
            error: Some("disk full".to_string()),
         },
      );
      assert_eq!(
         call.await.unwrap(),
         Err(ToolError::Failed("disk full".to_string()))
      );
   }

   #[tokio::test]
   async fn unanswered_calls_time_out_without_a_cancel() {
      let (bridge, events) = recording_bridge(Duration::from_millis(20));
      let result = bridge.call_tool("getDiagnostics", Value::Null).await;
      assert_eq!(result, Err(ToolError::Unavailable));
      assert_eq!(bridge.pending_count(), 0);
      assert_eq!(events.lock().unwrap().len(), 1);
   }

   #[tokio::test]
   async fn dropping_a_blocking_call_cancels_it_in_the_frontend() {
      let (bridge, events) = recording_bridge(Duration::from_millis(20));
      let call = {
         let bridge = bridge.clone();
         tokio::spawn(async move { bridge.call_tool("openDiff", Value::Null).await })
      };
      let request = wait_for_request(&events).await;
      tokio::time::sleep(Duration::from_millis(50)).await;
      assert!(!call.is_finished(), "openDiff must not time out");

      call.abort();
      let _ = call.await;
      assert_eq!(bridge.pending_count(), 0);
      assert_eq!(
         events.lock().unwrap().last(),
         Some(&BridgeEvent::Cancel {
            request_id: request.request_id,
         })
      );
   }

   #[tokio::test]
   async fn emit_failures_report_the_editor_as_unavailable() {
      let bridge = FrontendBridge::new(
         Duration::from_secs(1),
         Box::new(|_| Err("no windows".to_string())),
      );
      assert_eq!(
         bridge.call_tool("openFile", Value::Null).await,
         Err(ToolError::Unavailable)
      );
      assert_eq!(bridge.pending_count(), 0);
   }
}
