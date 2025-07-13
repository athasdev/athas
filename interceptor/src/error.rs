use axum::{
    body::Body,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::fmt;

/// Custom error type for the interceptor proxy
#[derive(Debug)]
pub enum ProxyError {
    /// Failed to read request body
    RequestBodyError(String),
    /// Failed to parse request JSON
    RequestParseError(String),
    /// Invalid HTTP method
    InvalidMethod(String),
    /// Failed to forward request to Anthropic
    ForwardError(String),
    /// Failed to read response from Anthropic
    ResponseReadError(String),
    /// Internal server error
    InternalError(String),
}

impl fmt::Display for ProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProxyError::RequestBodyError(msg) => write!(f, "Request body error: {}", msg),
            ProxyError::RequestParseError(msg) => write!(f, "Request parse error: {}", msg),
            ProxyError::InvalidMethod(msg) => write!(f, "Invalid method: {}", msg),
            ProxyError::ForwardError(msg) => write!(f, "Forward error: {}", msg),
            ProxyError::ResponseReadError(msg) => write!(f, "Response read error: {}", msg),
            ProxyError::InternalError(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for ProxyError {}

impl From<ProxyError> for Response<Body> {
    fn from(error: ProxyError) -> Self {
        let (status, message) = match &error {
            ProxyError::RequestBodyError(_)
            | ProxyError::RequestParseError(_)
            | ProxyError::InvalidMethod(_) => (StatusCode::BAD_REQUEST, error.to_string()),
            ProxyError::ForwardError(_) | ProxyError::ResponseReadError(_) => {
                (StatusCode::BAD_GATEWAY, error.to_string())
            }
            ProxyError::InternalError(_) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
        };

        Response::builder()
            .status(status)
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::json!({ "error": message }).to_string(),
            ))
            .unwrap()
    }
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response<Body> {
        self.into()
    }
}

/// Convenience function to create error responses
pub fn create_error_response(status: StatusCode, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::json!({ "error": message }).to_string(),
        ))
        .unwrap()
}
