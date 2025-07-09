use crate::types::{InterceptedRequest, InterceptorMessage};
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Clone)]
pub struct InterceptorState {
    pub requests: Arc<DashMap<Uuid, InterceptedRequest>>,
    pub tx: mpsc::UnboundedSender<InterceptorMessage>,
}

impl InterceptorState {
    pub fn new(tx: mpsc::UnboundedSender<InterceptorMessage>) -> Self {
        Self {
            requests: Arc::new(DashMap::new()),
            tx,
        }
    }

    pub fn add_request(&self, request: InterceptedRequest) {
        let id = request.id;
        self.requests.insert(id, request.clone());
        let _ = self.tx.send(InterceptorMessage::Request { data: request });
    }

    pub fn update_response(&self, id: Uuid, response: InterceptedRequest) {
        self.requests.insert(id, response.clone());
        let _ = self
            .tx
            .send(InterceptorMessage::Response { data: response });
    }

    pub fn send_error(&self, request_id: Uuid, error: String) {
        let _ = self
            .tx
            .send(InterceptorMessage::Error { request_id, error });
    }
}
