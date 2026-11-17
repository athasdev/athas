//! HTTP for model requests. Each request runs on a thread of its own with reqwest's blocking
//! client, so no async runtime has to run beside GPUI's executors; the response streams back over
//! a channel line by line. Dropping the receiver stops reading and closes the connection.

use std::fmt;

use futures::channel::mpsc;
#[cfg(not(target_family = "wasm"))]
use futures::channel::oneshot;
use serde_json::Value;

/// A failed request, with what the provider said about it.
#[derive(Clone, Debug, PartialEq)]
pub struct ProviderError {
    /// The HTTP status, when the provider answered.
    pub status: Option<u16>,
    pub message: String,
}

impl ProviderError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { status: None, message: message.into() }
    }

    pub fn status(status: u16, message: impl Into<String>) -> Self {
        Self { status: Some(status), message: message.into() }
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ProviderError {}

#[derive(Clone, Debug)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Value>,
}

/// What came back besides the body.
#[derive(Clone, Debug, Default)]
pub struct ResponseHead {
    pub headers: Vec<(String, String)>,
}

impl ResponseHead {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

pub type Lines = mpsc::UnboundedReceiver<Result<String, ProviderError>>;

/// The message in a provider's error body: `{"error":{"message":..}}`, `{"error":".."}` or
/// `{"message":..}`, else the body itself, cut short.
pub fn error_message(body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let message = parsed.as_ref().and_then(|value| {
        let error = value.get("error");
        error
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .or_else(|| error.and_then(Value::as_str))
            .or_else(|| value.get("message").and_then(Value::as_str))
            .or_else(|| value.get("detail").and_then(Value::as_str))
            .map(str::to_string)
    });
    let message = message.unwrap_or_else(|| body.trim().to_string());
    let first: String = message.lines().next().unwrap_or_default().chars().take(400).collect();
    first
}

#[cfg(not(target_family = "wasm"))]
mod native {
    use std::{
        io::{BufRead, BufReader},
        sync::OnceLock,
        time::Duration,
    };

    use super::*;

    /// Statuses worth one more try: overloaded or briefly unavailable.
    const RETRY_STATUSES: [u16; 7] = [408, 429, 500, 502, 503, 504, 529];
    const MAX_RETRIES: u32 = 2;

    fn client() -> &'static reqwest::blocking::Client {
        static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
        CLIENT.get_or_init(|| {
            reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                // Long answers stream for minutes; a stalled one ends with the turn's own stop.
                .timeout(Duration::from_secs(15 * 60))
                .user_agent(concat!("Athas/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_else(|_| reqwest::blocking::Client::new())
        })
    }

    fn send(request: &HttpRequest) -> Result<reqwest::blocking::Response, ProviderError> {
        send_with(client(), request, &|| false)
    }

    /// `cancelled` is asked before each retry: a turn the user stopped is not sent again (and
    /// billed) after the wait.
    fn send_with(client: &reqwest::blocking::Client, request: &HttpRequest, cancelled: &dyn Fn() -> bool) -> Result<reqwest::blocking::Response, ProviderError> {
        let mut attempt = 0;
        loop {
            let mut builder = match &request.body {
                Some(body) => client.post(&request.url).json(body),
                None => client.get(&request.url),
            };
            for (name, value) in &request.headers {
                builder = builder.header(name, value);
            }
            let response = builder.send().map_err(|error| {
                let host = reqwest::Url::parse(&request.url).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_default();
                if error.is_timeout() {
                    ProviderError::new(format!("{host} took too long to answer"))
                } else {
                    ProviderError::new(format!("Could not reach {host}"))
                }
            })?;
            let status = response.status().as_u16();
            if response.status().is_success() {
                return Ok(response);
            }
            if attempt < MAX_RETRIES && RETRY_STATUSES.contains(&status) {
                let wait = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.trim().parse::<u64>().ok())
                    .filter(|seconds| *seconds <= 20)
                    .map(Duration::from_secs)
                    .unwrap_or(Duration::from_millis(800 * 2u64.pow(attempt)));
                std::thread::sleep(wait);
                if cancelled() {
                    return Err(ProviderError::new("The request stopped"));
                }
                attempt += 1;
                continue;
            }
            let body = response.text().unwrap_or_default();
            let message = error_message(&body);
            let message = if message.is_empty() { format!("The request failed ({status})") } else { message };
            return Err(ProviderError::status(status, message));
        }
    }

    fn head(response: &reqwest::blocking::Response) -> ResponseHead {
        ResponseHead {
            headers: response
                .headers()
                .iter()
                .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
                .collect(),
        }
    }

    /// Sends `request` and streams the response body's lines.
    pub async fn stream_lines(request: HttpRequest) -> Result<(ResponseHead, Lines), ProviderError> {
        let (head_tx, head_rx) = oneshot::channel();
        std::thread::Builder::new()
            .name("ai-request".into())
            .spawn(move || {
                let response = match send_with(client(), &request, &|| head_tx.is_canceled()) {
                    Ok(response) => response,
                    Err(error) => {
                        let _ = head_tx.send(Err(error));
                        return;
                    }
                };
                let (lines_tx, lines_rx) = mpsc::unbounded();
                if head_tx.send(Ok((head(&response), lines_rx))).is_err() {
                    return;
                }
                let mut reader = BufReader::new(response);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) => return,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&buffer);
                            let line = line.trim_end_matches(['\n', '\r']).to_string();
                            if lines_tx.unbounded_send(Ok(line)).is_err() {
                                return;
                            }
                        }
                        Err(error) => {
                            let _ = lines_tx.unbounded_send(Err(ProviderError::new(format!("The connection broke: {error}"))));
                            return;
                        }
                    }
                }
            })
            .map_err(|error| ProviderError::new(format!("Could not start the request: {error}")))?;
        head_rx.await.unwrap_or_else(|_| Err(ProviderError::new("The request stopped")))
    }

    /// Sends `request` and reads the whole answer as JSON.
    pub async fn json(request: HttpRequest) -> Result<(ResponseHead, Value), ProviderError> {
        json_on(None, request).await
    }

    /// Like [`json`], giving up after `timeout` (Ollama's probes wait 5 s, `withTimeout`).
    pub async fn json_with_timeout(request: HttpRequest, timeout: Duration) -> Result<(ResponseHead, Value), ProviderError> {
        json_on(Some(timeout), request).await
    }

    async fn json_on(timeout: Option<Duration>, request: HttpRequest) -> Result<(ResponseHead, Value), ProviderError> {
        let (tx, rx) = oneshot::channel();
        std::thread::Builder::new()
            .name("ai-request".into())
            .spawn(move || {
                let sent = match timeout {
                    Some(timeout) => {
                        let client = reqwest::blocking::Client::builder()
                            .connect_timeout(timeout)
                            .timeout(timeout)
                            .user_agent(concat!("Athas/", env!("CARGO_PKG_VERSION")))
                            .build()
                            .unwrap_or_else(|_| reqwest::blocking::Client::new());
                        send_with(&client, &request, &|| false)
                    }
                    None => send(&request),
                };
                let result = sent.and_then(|response| {
                    let head = head(&response);
                    let text = response.text().map_err(|error| ProviderError::new(format!("The connection broke: {error}")))?;
                    let value = serde_json::from_str(&text).map_err(|_| ProviderError::new("The answer was not JSON"))?;
                    Ok((head, value))
                });
                let _ = tx.send(result);
            })
            .map_err(|error| ProviderError::new(format!("Could not start the request: {error}")))?;
        rx.await.unwrap_or_else(|_| Err(ProviderError::new("The request stopped")))
    }
}

#[cfg(not(target_family = "wasm"))]
pub use native::{json, json_with_timeout, stream_lines};

#[cfg(target_family = "wasm")]
pub async fn stream_lines(_: HttpRequest) -> Result<(ResponseHead, Lines), ProviderError> {
    Err(ProviderError::new("Model requests run in the desktop app"))
}

#[cfg(target_family = "wasm")]
pub async fn json_with_timeout(_: HttpRequest, _: std::time::Duration) -> Result<(ResponseHead, Value), ProviderError> {
    Err(ProviderError::new("Model requests run in the desktop app"))
}

#[cfg(target_family = "wasm")]
pub async fn json(_: HttpRequest) -> Result<(ResponseHead, Value), ProviderError> {
    Err(ProviderError::new("Model requests run in the desktop app"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_messages_come_from_the_body() {
        assert_eq!(error_message(r#"{"error":{"type":"x","message":"Bad key"}}"#), "Bad key");
        assert_eq!(error_message(r#"{"error":"Sign in"}"#), "Sign in");
        assert_eq!(error_message(r#"{"message":"Nope"}"#), "Nope");
        assert_eq!(error_message("plain\nsecond line"), "plain");
    }
}
