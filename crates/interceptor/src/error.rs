use axum::{
   body::Body,
   http::StatusCode,
   response::{IntoResponse, Response},
};
use thiserror::Error;

/// Custom error type for the interceptor proxy
#[derive(Error, Debug)]
pub enum ProxyError {
   /// Failed to read request body
   #[error("Request body error: {0}")]
   RequestBodyError(String),

   /// Failed to parse request JSON
   #[error("Request parse error: {0}")]
   RequestParseError(String),

   /// Invalid HTTP method
   #[error("Invalid method: {0}")]
   InvalidMethod(String),

   /// Failed to forward request to Anthropic
   #[error("Forward error: {0}")]
   ForwardError(String),

   /// Failed to read response from Anthropic
   #[error("Response read error: {0}")]
   ResponseReadError(String),

   /// Internal server error
   #[error("Internal error: {0}")]
   InternalError(String),

   /// Reqwest error
   #[error("HTTP client error")]
   Reqwest(#[from] reqwest::Error),

   /// Anyhow error for general error conversion
   #[error(transparent)]
   Anyhow(#[from] anyhow::Error),

   /// Axum error
   #[error("Axum error")]
   Axum(#[from] axum::Error),
}

impl From<ProxyError> for Response<Body> {
   fn from(error: ProxyError) -> Self {
      let (status, message) = match &error {
         ProxyError::RequestBodyError(_)
         | ProxyError::RequestParseError(_)
         | ProxyError::InvalidMethod(_) => (StatusCode::BAD_REQUEST, error.to_string()),
         ProxyError::ForwardError(_)
         | ProxyError::ResponseReadError(_)
         | ProxyError::Reqwest(_) => (StatusCode::BAD_GATEWAY, error.to_string()),
         ProxyError::InternalError(_) | ProxyError::Anyhow(_) | ProxyError::Axum(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
         }
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
