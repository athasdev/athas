//! A local HTTP/1.1 server for tests: it records every request and answers from a handler, so
//! the clients never reach athas.dev.

use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
};

#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub method: String,
    /// The path with its query string.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap_or(serde_json::Value::Null)
    }
}

#[derive(Clone, Debug)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

impl Response {
    pub fn json(status: u16, body: serde_json::Value) -> Self {
        Self { status, body: body.to_string() }
    }
}

type Handler = dyn Fn(&Request) -> Response + Send + Sync;

pub struct MockServer {
    url: String,
    requests: Arc<Mutex<Vec<Request>>>,
}

impl MockServer {
    /// Listens on a free local port and answers each request with `handler`.
    pub fn start(handler: impl Fn(&Request) -> Response + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("binding the mock server");
        let url = format!("http://{}", listener.local_addr().expect("mock server address"));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler: Arc<Handler> = Arc::new(handler);
        let recorded = requests.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let handler = handler.clone();
                let recorded = recorded.clone();
                thread::spawn(move || serve(stream, &*handler, &recorded));
            }
        });
        Self { url, requests }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }
}

fn serve(stream: TcpStream, handler: &Handler, recorded: &Mutex<Vec<Request>>) {
    let mut reader = BufReader::new(stream.try_clone().expect("cloning the stream"));
    let mut writer = stream;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            return;
        }
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or_default().to_string();
        let path = parts.next().unwrap_or_default().to_string();
        let mut headers = Vec::new();
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).unwrap_or(0) == 0 {
                return;
            }
            let header = header.trim_end();
            if header.is_empty() {
                break;
            }
            if let Some((key, value)) = header.split_once(':') {
                headers.push((key.trim().to_string(), value.trim().to_string()));
            }
        }
        let length = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.parse::<usize>().ok())
            .unwrap_or(0);
        let mut body = vec![0; length];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        let request = Request { method, path, headers, body: String::from_utf8_lossy(&body).into_owned() };
        recorded.lock().unwrap().push(request.clone());
        let response = handler(&request);
        let reply = format!(
            "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            response.status,
            response.body.len(),
            response.body
        );
        if writer.write_all(reply.as_bytes()).is_err() {
            return;
        }
    }
}
