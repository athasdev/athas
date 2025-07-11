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

        // Skip sending message if model is Haiku (metadata requests)
        if !matches!(
            request.parsed_request.model,
            crate::types::ClaudeModel::Haiku
        ) {
            let _ = self.tx.send(InterceptorMessage::Request { data: request });
        }
    }

    pub fn update_response(&self, id: Uuid, response: InterceptedRequest) {
        self.requests.insert(id, response.clone());

        // Skip sending message if model is Haiku (metadata requests)
        if !matches!(
            response.parsed_request.model,
            crate::types::ClaudeModel::Haiku
        ) {
            let _ = self
                .tx
                .send(InterceptorMessage::Response { data: response });
        }
    }

    pub fn send_error(&self, request_id: Uuid, error: String) {
        // Check if this request is for a Haiku model and skip if so
        if let Some(request) = self.requests.get(&request_id) {
            if matches!(
                request.parsed_request.model,
                crate::types::ClaudeModel::Haiku
            ) {
                return;
            }
        }

        let _ = self
            .tx
            .send(InterceptorMessage::Error { request_id, error });
    }

    pub fn send_stream_chunk(&self, request_id: Uuid, chunk: crate::types::StreamingChunk) {
        // Check if this request is for a Haiku model and skip if so
        if let Some(request) = self.requests.get(&request_id) {
            if matches!(
                request.parsed_request.model,
                crate::types::ClaudeModel::Haiku
            ) {
                return;
            }
        }

        let _ = self
            .tx
            .send(InterceptorMessage::StreamChunk { request_id, chunk });
    }
}
