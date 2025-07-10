use crate::{
    parser::{parse_non_streaming_response, parse_streaming_response},
    state::InterceptorState,
    types::{InterceptedRequest, InterceptorMessage, MessageContent, ParsedRequest},
};
use anyhow::{Context, Result};
use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
};
use chrono::Utc;
use futures::StreamExt;
use reqwest::header::{CONTENT_LENGTH, HOST, HeaderName};
use std::{collections::HashMap, str::FromStr, time::Instant};
use thin_logger::log::{self, debug, error, info};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

const ANTHROPIC_API_BASE: &str = "https://api.anthropic.com";

pub async fn start_proxy_server(
    proxy_port: u16,
) -> Result<mpsc::UnboundedReceiver<InterceptorMessage>> {
    let (tx, rx) = mpsc::unbounded_channel::<InterceptorMessage>();
    let state = InterceptorState::new(tx);

    let app = Router::new().fallback(any(proxy_handler)).with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{proxy_port}"))
        .await
        .context("Failed to bind proxy server")?;

    log::info!(
        "Claude Code Proxy running on http://localhost:{}",
        proxy_port
    );

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("Proxy server error: {}", e);
        }
    });

    Ok(rx)
}

pub async fn proxy_handler(
    State(state): State<InterceptorState>,
    uri: Uri,
    headers: HeaderMap,
    request: Request,
) -> impl IntoResponse {
    let request_id = Uuid::new_v4();
    let start_time = Instant::now();
    let method = request.method().clone();
    let method_str = method.to_string();
    let path = uri.path().to_string();

    debug!("Request {} -> {}", request_id, path);

    // Extract body
    let body_bytes = match axum::body::to_bytes(request.into_body(), usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to read request body: {}", e);
            return create_error_response(StatusCode::BAD_REQUEST, "Failed to read request body");
        }
    };

    let body_str = String::from_utf8_lossy(&body_bytes);

    // Parse request
    let parsed_request: ParsedRequest = match serde_json::from_str(&body_str) {
        Ok(req) => req,
        Err(e) => {
            error!("Failed to parse request: {}", e);
            return create_error_response(StatusCode::BAD_REQUEST, "Failed to parse request");
        }
    };

    // Log user messages compactly
    for msg in &parsed_request.messages {
        if matches!(msg.role, crate::types::Role::User) {
            let content = match &msg.content {
                MessageContent::Text(text) => text.clone(),
                MessageContent::Blocks(blocks) => {
                    // Extract text content and tool results from blocks
                    let mut parts = Vec::new();
                    let mut tool_results = Vec::new();

                    for block in blocks {
                        match block.content_type.as_str() {
                            "text" => {
                                if let Some(text) = &block.text {
                                    parts.push(text.clone());
                                }
                            }
                            "tool_result" => {
                                if let Some(id) = &block.tool_use_id {
                                    tool_results.push(format!("[Tool Result: {}]", id));
                                }
                            }
                            _ => {}
                        }
                    }

                    if !tool_results.is_empty() {
                        info!("🔄 Tool results: {}", tool_results.join(", "));
                    }

                    parts.join(" ")
                }
            };
            if !content.is_empty() {
                // Truncate long messages
                let display_content = if content.len() > 100 {
                    format!("{}...", &content[..97])
                } else {
                    content
                };
                info!("👤 User: {}", display_content);
            }
        }
    }

    // Convert headers
    let headers_map: HashMap<String, String> = headers
        .iter()
        .filter_map(|(k, v)| {
            let key = k.as_str().to_string();
            let value = v.to_str().ok()?.to_string();
            Some((key, value))
        })
        .collect();

    // Create intercepted request
    let mut intercepted = InterceptedRequest {
        id: request_id,
        timestamp: Utc::now(),
        method: method_str.clone(),
        path: path.clone(),
        parsed_request: parsed_request.clone(),
        raw_request: body_str.to_string(),
        headers: headers_map,
        parsed_response: None,
        raw_response: None,
        streaming_chunks: None,
        duration_ms: None,
        error: None,
    };

    state.add_request(intercepted.clone());

    // Forward to Anthropic
    let client = reqwest::Client::new();
    let url = format!("{ANTHROPIC_API_BASE}{path}");

    let mut forward_headers = HeaderMap::new();
    for (key, value) in headers.iter() {
        let key_str = key.as_str();
        if key_str != HOST.as_str() && key_str != CONTENT_LENGTH.as_str() {
            if let Ok(header_name) = HeaderName::from_str(key_str) {
                forward_headers.insert(header_name, value.clone());
            }
        }
    }

    debug!("Forward {} -> {}", request_id, url);

    let response = match client
        .request(method, &url)
        .headers(forward_headers)
        .body(body_bytes.to_vec())
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            let error = format!("Failed to forward request: {e}");
            error!("Request error: {}", error);
            intercepted.error = Some(error.clone());
            intercepted.duration_ms = Some(start_time.elapsed().as_millis() as u64);
            state.update_response(request_id, intercepted);
            state.send_error(request_id, error);
            return create_error_response(StatusCode::BAD_GATEWAY, "Failed to forward request");
        }
    };

    let status = response.status();
    let response_headers = response.headers().clone();

    debug!("Response {} - status: {}", request_id, status.as_u16());

    // Handle streaming vs non-streaming
    if parsed_request.stream.unwrap_or(false) {
        // Streaming response
        let (tx, rx) = mpsc::channel::<Result<Bytes, axum::Error>>(100);
        let state_clone = state.clone();

        tokio::spawn(async move {
            let mut captured_response = String::new();
            let mut stream = response.bytes_stream();

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        let chunk_str = String::from_utf8_lossy(&bytes);
                        captured_response.push_str(&chunk_str);

                        // Parse SSE chunks and send to WebSocket
                        for line in chunk_str.lines() {
                            if line.starts_with("data: ") {
                                let data = &line[6..];
                                if let Ok(chunk) =
                                    serde_json::from_str::<crate::types::StreamingChunk>(data)
                                {
                                    state_clone.send_stream_chunk(request_id, chunk);
                                }
                            }
                        }

                        // Send chunk to client
                        if tx.send(Ok(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Error reading stream chunk: {}", e);
                        let _ = tx.send(Err(axum::Error::new(e))).await;
                        break;
                    }
                }
            }

            // Parse streaming response
            if let Ok((chunks, final_response)) = parse_streaming_response(&captured_response) {
                intercepted.streaming_chunks = Some(chunks);
                intercepted.parsed_response = final_response;
            }

            intercepted.raw_response = Some(captured_response);
            intercepted.duration_ms = Some(start_time.elapsed().as_millis() as u64);

            // Log assistant response with tool usage
            if let Some(ref parsed) = intercepted.parsed_response {
                if let Some(ref content) = parsed.content {
                    let mut text_parts = Vec::new();
                    let mut tool_uses = Vec::new();

                    for block in content {
                        match block.content_type.as_str() {
                            "text" => {
                                if let Some(text) = &block.text {
                                    text_parts.push(text.clone());
                                }
                            }
                            "tool_use" => {
                                if let Some(name) = &block.name {
                                    tool_uses.push(name.clone());
                                }
                            }
                            _ => {}
                        }
                    }

                    if !tool_uses.is_empty() {
                        info!("🔧 Tools called: {}", tool_uses.join(", "));
                    }

                    if !text_parts.is_empty() {
                        let response_text = text_parts.join(" ");
                        let display_response = if response_text.len() > 150 {
                            format!("{}...", &response_text[..147])
                        } else {
                            response_text
                        };
                        info!(
                            "🤖 Assistant ({}ms): {}",
                            intercepted.duration_ms.unwrap_or(0),
                            display_response
                        );
                    }
                }
            }

            state_clone.update_response(request_id, intercepted);
        });

        // Return streaming response
        let stream = ReceiverStream::new(rx);
        let body = Body::from_stream(stream);

        let mut builder = Response::builder().status(status);
        for (key, value) in response_headers.iter() {
            builder = builder.header(key, value);
        }

        builder.body(body).unwrap()
    } else {
        // Non-streaming response
        match response.text().await {
            Ok(response_text) => {
                intercepted.parsed_response = parse_non_streaming_response(&response_text).ok();
                intercepted.raw_response = Some(response_text.clone());
                intercepted.duration_ms = Some(start_time.elapsed().as_millis() as u64);

                // Log assistant response with tool usage
                if let Some(ref parsed) = intercepted.parsed_response {
                    if let Some(ref content) = parsed.content {
                        let mut text_parts = Vec::new();
                        let mut tool_uses = Vec::new();

                        for block in content {
                            match block.content_type.as_str() {
                                "text" => {
                                    if let Some(text) = &block.text {
                                        text_parts.push(text.clone());
                                    }
                                }
                                "tool_use" => {
                                    if let Some(name) = &block.name {
                                        tool_uses.push(name.clone());
                                    }
                                }
                                _ => {}
                            }
                        }

                        if !tool_uses.is_empty() {
                            info!("🔧 Tools called: {}", tool_uses.join(", "));
                        }

                        if !text_parts.is_empty() {
                            let response_text = text_parts.join(" ");
                            let display_response = if response_text.len() > 150 {
                                format!("{}...", &response_text[..147])
                            } else {
                                response_text
                            };
                            info!(
                                "🤖 Assistant ({}ms): {}",
                                intercepted.duration_ms.unwrap_or(0),
                                display_response
                            );
                        }
                    }
                }

                state.update_response(request_id, intercepted);

                let mut builder = Response::builder().status(status);
                for (key, value) in response_headers.iter() {
                    builder = builder.header(key, value);
                }

                builder.body(Body::from(response_text)).unwrap()
            }
            Err(e) => {
                let error = format!("Failed to read response: {e}");
                error!("Response error: {}", error);
                intercepted.error = Some(error.clone());
                intercepted.duration_ms = Some(start_time.elapsed().as_millis() as u64);
                state.update_response(request_id, intercepted);
                state.send_error(request_id, error);
                create_error_response(StatusCode::BAD_GATEWAY, "Failed to read response")
            }
        }
    }
}

fn create_error_response(status: StatusCode, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::json!({ "error": message }).to_string(),
        ))
        .unwrap()
}
