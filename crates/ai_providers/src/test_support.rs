//! A local HTTP server that answers like a model provider, so tests never call a paid API.
//! Each request takes the next queued response and is recorded for the test to inspect.

use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde_json::{Value, json};

#[derive(Clone, Debug)]
pub struct MockResponse {
    pub status: u16,
    pub content_type: String,
    pub body: String,
}

impl MockResponse {
    pub fn json(status: u16, value: Value) -> Self {
        Self { status, content_type: "application/json".into(), body: value.to_string() }
    }

    /// Server-sent events, one per value, as Anthropic streams them.
    pub fn sse(events: &[Value]) -> Self {
        let body = events.iter().map(|event| format!("data: {event}\n\n")).collect();
        Self { status: 200, content_type: "text/event-stream".into(), body }
    }

    /// OpenAI-style chunks ending with `[DONE]`.
    pub fn openai(chunks: &[Value]) -> Self {
        let mut response = Self::sse(chunks);
        response.body.push_str("data: [DONE]\n\n");
        response
    }

    /// An OpenAI-style answer of plain text.
    pub fn openai_text(text: &str) -> Self {
        Self::openai(&[
            json!({ "choices": [{ "index": 0, "delta": { "content": text } }] }),
            json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }] }),
            json!({ "choices": [], "usage": { "prompt_tokens": 10, "completion_tokens": 5 } }),
        ])
    }

    /// An OpenAI-style answer that calls one tool.
    pub fn openai_tool_call(id: &str, name: &str, input: Value) -> Self {
        Self::openai(&[
            json!({ "choices": [{ "index": 0, "delta": { "tool_calls": [{ "index": 0, "id": id, "function": { "name": name, "arguments": input.to_string() } }] } }] }),
            json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "tool_calls" }] }),
            json!({ "choices": [], "usage": { "prompt_tokens": 20, "completion_tokens": 8 } }),
        ])
    }
}

#[derive(Clone, Debug)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

impl RecordedRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

pub struct MockServer {
    /// `http://127.0.0.1:<port>`.
    pub url: String,
    responses: Arc<Mutex<VecDeque<MockResponse>>>,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
    stop: Arc<AtomicBool>,
}

impl MockServer {
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a local port");
        let url = format!("http://{}", listener.local_addr().expect("local address"));
        let responses: Arc<Mutex<VecDeque<MockResponse>>> = Arc::default();
        let requests: Arc<Mutex<Vec<RecordedRequest>>> = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (thread_responses, thread_requests, thread_stop) = (responses.clone(), requests.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if thread_stop.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(stream) = stream else { continue };
                let (responses, requests) = (thread_responses.clone(), thread_requests.clone());
                std::thread::spawn(move || serve(stream, &responses, &requests));
            }
        });
        Self { url, responses, requests, stop }
    }

    pub fn push(&self, response: MockResponse) {
        self.responses.lock().unwrap().push_back(response);
    }

    pub fn requests(&self) -> Vec<RecordedRequest> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wakes the accept loop so it sees the flag.
        let _ = TcpStream::connect(self.url.trim_start_matches("http://"));
    }
}

fn serve(stream: TcpStream, responses: &Mutex<VecDeque<MockResponse>>, requests: &Mutex<Vec<RecordedRequest>>) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone the stream"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = Vec::new();
    let mut length = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let (name, value) = (name.trim().to_string(), value.trim().to_string());
            if name.eq_ignore_ascii_case("content-length") {
                length = value.parse().unwrap_or(0);
            }
            headers.push((name, value));
        }
    }
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body);
    let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
    requests.lock().unwrap().push(RecordedRequest { method, path, headers, body });
    let response = responses
        .lock()
        .unwrap()
        .pop_front()
        .unwrap_or_else(|| MockResponse::json(500, json!({ "error": { "message": "No response queued" } })));
    let mut stream = stream;
    let head = format!(
        "HTTP/1.1 {} Mock\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        response.content_type,
        response.body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(response.body.as_bytes());
    let _ = stream.flush();
}
