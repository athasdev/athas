use anyhow::Result;
use interceptor::{
    InterceptorMessage, start_proxy_server_with_ws, websocket::create_ws_broadcaster,
};
use thin_logger::log::{self, LevelFilter};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<()> {
    thin_logger::build(LevelFilter::Info.into()).init();

    let proxy_port = 3456;

    log::info!("Starting Claude Code Interceptor with WebSocket support");

    let (rx, ws_state) = start_proxy_server_with_ws(proxy_port).await?;

    // Create two receivers - one for logging, one for WebSocket broadcast
    let (broadcast_tx, broadcast_rx) = mpsc::unbounded_channel::<InterceptorMessage>();
    let (log_tx, mut log_rx) = mpsc::unbounded_channel::<InterceptorMessage>();

    // Spawn WebSocket broadcaster
    let ws_broadcaster = create_ws_broadcaster(ws_state, broadcast_rx);

    // Spawn message distributor
    let distributor = tokio::spawn(async move {
        let mut rx = rx;
        log::info!("Message distributor started");
        while let Some(message) = rx.recv().await {
            log::info!("Distributor received message: {:?}", message.type_name());
            let _ = broadcast_tx.send(message.clone());
            let _ = log_tx.send(message);
        }
        log::info!("Message distributor ended");
    });

    // Logger task
    let logger = tokio::spawn(async move {
        while let Some(message) = log_rx.recv().await {
            match message {
                InterceptorMessage::Request { data } => {
                    log::info!("New request: {:?}", data.id);
                }
                InterceptorMessage::Response { data } => {
                    log::info!("Response for request: {:?}", data.id);
                }
                InterceptorMessage::StreamChunk { request_id, chunk } => {
                    log::info!(
                        "Stream chunk for request: {:?} - type: {}",
                        request_id,
                        chunk.chunk_type
                    );
                }
                InterceptorMessage::Error { request_id, error } => {
                    log::error!("Error for request {:?}: {}", request_id, error);
                }
            }
        }
    });

    // Wait for tasks
    tokio::select! {
        _ = distributor => log::info!("Distributor task ended"),
        _ = ws_broadcaster => log::info!("WebSocket broadcaster ended"),
        _ = logger => log::info!("Logger task ended"),
    }

    Ok(())
}
