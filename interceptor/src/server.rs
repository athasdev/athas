use anyhow::{Context, Result};
use axum::{Router, routing::get};
use std::net::SocketAddr;
use thin_logger::log::{error, info};
use tokio::sync::mpsc;

use crate::{
    state::InterceptorState,
    types::InterceptorMessage,
    websocket::{WsState, ws_handler},
};

#[derive(Clone)]
pub struct AppState {
    pub interceptor: InterceptorState,
    pub ws: WsState,
}

pub async fn start_proxy_server_with_ws(
    proxy_port: u16,
) -> Result<(
    mpsc::UnboundedReceiver<InterceptorMessage>,
    WsState,
    tokio::task::JoinHandle<()>,
)> {
    let (tx, rx) = mpsc::unbounded_channel::<InterceptorMessage>();
    let interceptor_state = InterceptorState::new(tx);
    let ws_state = WsState::new();

    let app_state = AppState {
        interceptor: interceptor_state,
        ws: ws_state.clone(),
    };

    let app = Router::new()
        .route("/ws", get(ws_handler_wrapper))
        .fallback(axum::routing::any(proxy_handler_wrapper))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], proxy_port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("Failed to bind proxy server")?;

    info!(
        "Claude Code Proxy with WebSocket running on http://localhost:{}",
        proxy_port
    );
    info!("WebSocket endpoint: ws://localhost:{}/ws", proxy_port);

    let server_handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!("Proxy server error: {}", e);
        }
    });

    Ok((rx, ws_state, server_handle))
}

async fn ws_handler_wrapper(
    ws: axum::extract::WebSocketUpgrade,
    axum::extract::State(app_state): axum::extract::State<AppState>,
) -> axum::response::Response {
    ws_handler(ws, axum::extract::State(app_state.ws)).await
}

async fn proxy_handler_wrapper(
    axum::extract::State(app_state): axum::extract::State<AppState>,
    uri: axum::http::Uri,
    headers: axum::http::HeaderMap,
    req: axum::extract::Request,
) -> impl axum::response::IntoResponse {
    use crate::proxy::proxy_handler;
    proxy_handler(
        axum::extract::State(app_state.interceptor),
        uri,
        headers,
        req,
    )
    .await
}
