use crate::{
    proxy::proxy_handler,
    state::InterceptorState,
    types::InterceptorMessage,
    websocket::{WsState, handle_socket},
};
use anyhow::{Context, Result};
use axum::{
    Router,
    extract::{Request, State, WebSocketUpgrade},
    http::{HeaderMap, Uri},
    routing::get,
};
use thin_logger::log::{error, info};
use tokio::{
    net::TcpListener,
    sync::mpsc::{UnboundedReceiver, unbounded_channel},
    task::JoinHandle,
};

#[derive(Clone)]
pub struct AppState {
    pub interceptor: InterceptorState,
    pub ws: WsState,
}

pub async fn start_proxy_server_with_ws(
    proxy_port: u16,
) -> Result<(
    UnboundedReceiver<InterceptorMessage>,
    WsState,
    JoinHandle<()>,
)> {
    let (tx, rx) = unbounded_channel::<InterceptorMessage>();
    let interceptor_state = InterceptorState::new(tx);
    let ws_state = WsState::new();

    let app_state = AppState {
        interceptor: interceptor_state,
        ws: ws_state.clone(),
    };

    let app = Router::new()
        .route("/ws", get(|ws: WebSocketUpgrade, State(app_state): State<AppState>| async move {
            {
                let State(ws_state) = State(app_state.ws);
                async move {
                    ws.on_upgrade(|socket| handle_socket(socket, ws_state))
                }
            }.await
        }))
        .fallback(axum::routing::any(
            |State(app_state): State<AppState>,
             uri: Uri,
             headers: HeaderMap,
             req: Request| async move {
                proxy_handler(State(app_state.interceptor), uri, headers, req).await
            },
        ))
        .with_state(app_state);

    let listener = TcpListener::bind(format!("127.0.0.1:{proxy_port}"))
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
