use crate::{
    error::ProxyError,
    helpers::{extract_response_content, log_assistant_response, log_user_messages},
    parser::parse_streaming_response,
    state::InterceptorState,
    types::{
        ChunkType, ContentBlock, InterceptedRequest, InterceptorMessage, ParsedRequest,
        StreamingChunk,
    },
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

/// Builds headers for forwarding to Anthropic API
fn build_forward_headers(headers: &HeaderMap) -> HeaderMap {
    let mut forward_headers = HeaderMap::new();
    for (key, value) in headers.iter() {
        let key_str = key.as_str();
        if key_str != HOST.as_str() && key_str != CONTENT_LENGTH.as_str() {
            if let Ok(header_name) = HeaderName::from_str(key_str) {
                forward_headers.insert(header_name, value.clone());
            }
        }
    }
    forward_headers
}

/// Creates an InterceptedRequest from the parsed data
fn create_intercepted_request(
    request_id: Uuid,
    method: String,
    path: String,
    headers: HeaderMap,
    body_str: String,
    parsed_request: ParsedRequest,
) -> InterceptedRequest {
    let headers_map: HashMap<String, String> = headers
        .iter()
        .filter_map(|(k, v)| {
            let key = k.as_str().to_string();
            let value = v.to_str().ok()?.to_string();
            Some((key, value))
        })
        .collect();

    InterceptedRequest {
        id: request_id,
        timestamp: Utc::now(),
        method,
        path,
        parsed_request,
        raw_request: body_str,
        headers: headers_map,
        parsed_response: None,
        raw_response: None,
        streaming_chunks: Vec::new(),
        duration_ms: None,
        error: None,
    }
}

/// Processes streaming response chunks
fn process_streaming_response(
    response: reqwest::Response,
    state: InterceptorState,
    request_id: Uuid,
    start_time: Instant,
    mut intercepted: InterceptedRequest,
) -> (
    mpsc::Receiver<Result<Bytes, axum::Error>>,
    StatusCode,
    HeaderMap,
) {
    debug!("🌊 Processing STREAMING response for {}", request_id);
    let status = response.status();
    let response_headers = response.headers().clone();
    let (tx, rx) = mpsc::channel::<Result<Bytes, axum::Error>>(100);

    tokio::spawn(async move {
        let mut captured_response = String::new();
        let mut stream = response.bytes_stream();
        let mut tool_json_accumulator: Option<String> = None;
        let mut current_tool_name: Option<String> = None;
        let mut current_tool_id: Option<String> = None;

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let chunk_str = String::from_utf8_lossy(&bytes);
                    captured_response.push_str(&chunk_str);

                    // Parse SSE chunks and send to WebSocket
                    for line in chunk_str.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(chunk) = serde_json::from_str::<StreamingChunk>(data) {
                                // Handle tool use accumulation
                                match chunk.chunk_type {
                                    ChunkType::ContentBlockStart => {
                                        if let Some(ref content_block) = chunk.content_block {
                                            if content_block.content_type == "tool_use" {
                                                // Starting a new tool use block
                                                tool_json_accumulator = Some(String::new());
                                                current_tool_name = content_block.name.clone();
                                                current_tool_id = content_block.id.clone();
                                            }
                                        }
                                    }
                                    ChunkType::ContentBlockDelta => {
                                        if let Some(ref delta) = chunk.delta {
                                            if let Some(ref partial_json) = delta.partial_json {
                                                if let Some(ref mut accumulator) =
                                                    tool_json_accumulator
                                                {
                                                    accumulator.push_str(partial_json);
                                                }
                                            }
                                        }
                                    }
                                    ChunkType::ContentBlockStop => {
                                        // Finalize tool use block with accumulated JSON
                                        if let Some(json_str) = tool_json_accumulator.take() {
                                            if let Ok(json_value) =
                                                serde_json::from_str::<serde_json::Value>(&json_str)
                                            {
                                                // Create a synthetic content_block_start with the complete input
                                                let complete_block = StreamingChunk {
                                                    chunk_type: ChunkType::ContentBlockStart,
                                                    index: chunk.index,
                                                    delta: None,
                                                    content_block: Some(ContentBlock {
                                                        content_type: "tool_use".to_string(),
                                                        text: None,
                                                        id: current_tool_id.clone(),
                                                        name: current_tool_name.clone(),
                                                        input: Some(json_value),
                                                        content: None,
                                                        tool_use_id: None,
                                                    }),
                                                    message: None,
                                                    error: None,
                                                };
                                                // Send the complete tool use block
                                                state.send_stream_chunk(request_id, complete_block);
                                            }
                                            current_tool_name = None;
                                            current_tool_id = None;
                                        }
                                    }
                                    _ => {}
                                }

                                state.send_stream_chunk(request_id, chunk);
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
            intercepted.streaming_chunks = chunks;
            intercepted.parsed_response = final_response;
        }

        intercepted.raw_response = Some(captured_response);
        intercepted.duration_ms = Some(start_time.elapsed().as_millis() as u64);

        // Log assistant response
        if let Some(ref parsed) = intercepted.parsed_response {
            let (text_parts, tool_uses) = extract_response_content(&parsed.content);
            log_assistant_response(
                &text_parts,
                &tool_uses,
                intercepted.duration_ms.unwrap_or(0),
                true, // streaming
            );
        }

        state.update_response(request_id, intercepted);
    });

    (rx, status, response_headers)
}

/// Processes non-streaming response
async fn process_non_streaming_response(
    response: reqwest::Response,
    state: &InterceptorState,
    request_id: Uuid,
    start_time: Instant,
    mut intercepted: InterceptedRequest,
) -> Result<(String, StatusCode, HeaderMap)> {
    debug!("📦 Processing NON-STREAMING response for {}", request_id);

    let status = response.status();
    let response_headers = response.headers().clone();
    let response_text = response.text().await.context("Failed to read response")?;

    intercepted.parsed_response = {
        let response_text: &str = &response_text;
        serde_json::from_str(response_text).context("Failed to parse response")
    }
    .ok();
    intercepted.raw_response = Some(response_text.clone());
    intercepted.duration_ms = Some(start_time.elapsed().as_millis() as u64);

    // Log assistant response
    if let Some(ref parsed) = intercepted.parsed_response {
        let (text_parts, tool_uses) = extract_response_content(&parsed.content);
        log_assistant_response(
            &text_parts,
            &tool_uses,
            intercepted.duration_ms.unwrap_or(0),
            false, // non-streaming
        );
    }

    state.update_response(request_id, intercepted);
    Ok((response_text, status, response_headers))
}

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
) -> Result<impl IntoResponse, ProxyError> {
    let request_id = Uuid::new_v4();
    let start_time = Instant::now();
    let method = request.method().clone();
    let method_str = method.to_string();
    let path = uri.path().to_string();

    debug!("Request {} -> {}", request_id, path);

    // Extract and parse request body
    let body_bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .context("Failed to read request body")?;

    // Parse request body inline with proper UTF-8 validation
    let body_str = std::str::from_utf8(&body_bytes)
        .context("Request body is not valid UTF-8")?
        .to_string();
    let parsed_request: ParsedRequest =
        serde_json::from_str(&body_str).context("Failed to parse request JSON")?;

    log_user_messages(&parsed_request.messages);

    let intercepted = create_intercepted_request(
        request_id,
        method_str.clone(),
        path.clone(),
        headers.clone(),
        body_str,
        parsed_request.clone(),
    );

    state.add_request(intercepted.clone());

    // Forward to Anthropic
    let client = reqwest::Client::new();
    let url = format!("{ANTHROPIC_API_BASE}{path}");
    let forward_headers = build_forward_headers(&headers);

    debug!("Forward {} -> {}", request_id, url);

    let method_reqwest =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).context("Invalid HTTP method")?;

    // we forward the request to anthropic in this block
    let response = client
        .request(method_reqwest, &url)
        .headers(forward_headers)
        .body(body_bytes.to_vec())
        .send()
        .await?;

    let status = response.status();
    debug!("Response {} - status: {}", request_id, status.as_u16());

    // Handle streaming vs non-streaming
    let is_streaming = parsed_request.stream;
    info!(
        "{} Request {} - Mode: {}",
        if is_streaming { "🌊" } else { "📦" },
        request_id,
        if is_streaming {
            "STREAMING"
        } else {
            "NON-STREAMING"
        }
    );

    if is_streaming {
        let (rx, status, response_headers) =
            process_streaming_response(response, state, request_id, start_time, intercepted);

        // Return streaming response
        let stream = ReceiverStream::new(rx);
        let body = Body::from_stream(stream);

        let mut builder = Response::builder().status(status);
        for (key, value) in response_headers.iter() {
            builder = builder.header(key, value);
        }

        Ok(builder.body(body).unwrap())
    } else {
        let (response_text, status, response_headers) =
            process_non_streaming_response(response, &state, request_id, start_time, intercepted)
                .await?;

        let mut builder = Response::builder().status(status);
        for (key, value) in response_headers.iter() {
            builder = builder.header(key, value);
        }
        Ok(builder.body(Body::from(response_text)).unwrap())
    }
}
