use anyhow::Result;
use interceptor::{InterceptorMessage, start_proxy_server};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(fmt::layer().with_target(true))
        .with(EnvFilter::from_default_env().add_directive("interceptor=info".parse()?))
        .init();

    let proxy_port = 3456;

    tracing::info!("Starting Claude Code Interceptor");

    let mut rx = start_proxy_server(proxy_port).await?;

    // Example consumer - just log messages
    while let Some(message) = rx.recv().await {
        match message {
            InterceptorMessage::Request { data } => {
                tracing::info!("New request: {:?}", data.id);
            }
            InterceptorMessage::Response { data } => {
                tracing::info!("Response for request: {:?}", data.id);
            }
            InterceptorMessage::StreamChunk {
                request_id,
                chunk: _,
            } => {
                tracing::debug!("Stream chunk for request: {:?}", request_id);
            }
            InterceptorMessage::Error { request_id, error } => {
                tracing::error!("Error for request {:?}: {}", request_id, error);
            }
        }
    }

    Ok(())
}
