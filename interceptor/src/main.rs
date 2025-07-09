use anyhow::Result;
use interceptor::{InterceptorMessage, start_proxy_server};
use thin_logger::log::{self, LevelFilter};

#[tokio::main]
async fn main() -> Result<()> {
    thin_logger::build(LevelFilter::Info.into()).init();

    let proxy_port = 3456;

    log::info!("Starting Claude Code Interceptor");

    let mut rx = start_proxy_server(proxy_port).await?;

    // Example consumer - just log messages
    while let Some(message) = rx.recv().await {
        match message {
            InterceptorMessage::Request { data } => {
                log::info!("New request: {:?}", data.id);
            }
            InterceptorMessage::Response { data } => {
                log::info!("Response for request: {:?}", data.id);
            }
            InterceptorMessage::StreamChunk {
                request_id,
                chunk: _,
            } => {
                log::debug!("Stream chunk for request: {:?}", request_id);
            }
            InterceptorMessage::Error { request_id, error } => {
                log::error!("Error for request {:?}: {}", request_id, error);
            }
        }
    }

    Ok(())
}
