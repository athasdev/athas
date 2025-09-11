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
   requested_port: Option<u16>,
) -> Result<(
   UnboundedReceiver<InterceptorMessage>,
   WsState,
   JoinHandle<()>,
   u16,
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

   let port = requested_port.unwrap_or(0);
   let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
      .await
      .with_context(|| format!("Failed to bind `TcpListener` to port {port}"))?;
   let assigned_port = listener
      .local_addr()
      .with_context(|| "Failed to get local address for proxy server")?
      .port();

   info!(
      "Claude Code Proxy with WebSocket running on http://localhost:{}",
      assigned_port
   );

   info!("WebSocket endpoint: ws://localhost:{}/ws", assigned_port);

   let server_handle = tokio::spawn(async move {
      if let Err(e) = axum::serve(listener, app).await {
         error!("Proxy server error: {}", e);
      }
   });

   Ok((rx, ws_state, server_handle, assigned_port))
}
