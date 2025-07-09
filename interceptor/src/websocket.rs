use axum::{
    extract::{State, WebSocketUpgrade, ws::WebSocket},
    response::Response,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use thin_logger::log::info;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::types::InterceptorMessage;

pub type WsClients = Arc<DashMap<Uuid, mpsc::UnboundedSender<InterceptorMessage>>>;

#[derive(Clone)]
pub struct WsState {
    pub clients: WsClients,
}

impl WsState {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(DashMap::new()),
        }
    }

    pub fn broadcast(&self, message: InterceptorMessage) {
        let serialized = match serde_json::to_string(&message) {
            Ok(msg) => msg,
            Err(e) => {
                info!("Failed to serialize message: {}", e);
                return;
            }
        };

        info!(
            "Broadcasting message to {} clients: {}",
            self.clients.len(),
            &serialized[..serialized.len().min(100)]
        );

        self.clients.retain(|id, tx| {
            if tx.send(message.clone()).is_err() {
                info!("Client {} disconnected, removing", id);
                false
            } else {
                true
            }
        });
    }
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(ws_state): State<WsState>) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, ws_state))
}

async fn handle_socket(socket: WebSocket, ws_state: WsState) {
    let client_id = Uuid::new_v4();
    info!("WebSocket client connected: {}", client_id);

    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<InterceptorMessage>();

    ws_state.clients.insert(client_id, tx);

    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(serialized) = serde_json::to_string(&msg) {
                if sender
                    .send(axum::extract::ws::Message::Text(serialized))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let axum::extract::ws::Message::Close(_) = msg {
                break;
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => {},
        _ = &mut recv_task => {},
    }

    ws_state.clients.remove(&client_id);
    info!("WebSocket client disconnected: {}", client_id);
}

pub fn create_ws_broadcaster(
    ws_state: WsState,
    mut rx: mpsc::UnboundedReceiver<InterceptorMessage>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        info!("WebSocket broadcaster started");
        while let Some(message) = rx.recv().await {
            info!("Broadcasting message type: {:?}", message.type_name());
            ws_state.broadcast(message);
        }
        info!("WebSocket broadcaster ended");
    })
}
