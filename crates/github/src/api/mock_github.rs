//! A minimal local HTTP server standing in for api.github.com in tests.
//!
//! Starting a `MockGitHub` points every `GitHubApi` created on the same thread at it until the
//! mock is dropped. Routes answer by method and path (or path plus exact query when the route
//! includes one), and every request is recorded for assertions.

use serde_json::Value;
use std::{
   cell::RefCell,
   collections::HashMap,
   io::{BufRead, BufReader, Write},
   net::{TcpListener, TcpStream},
   sync::{
      Arc, Mutex,
      atomic::{AtomicBool, Ordering},
   },
   thread,
};

thread_local! {
   static BASE_URL: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub(crate) fn base_url() -> Option<String> {
   BASE_URL.with(|base| base.borrow().clone())
}

#[derive(Clone, Debug)]
pub(crate) struct MockResponse {
   status: u16,
   headers: Vec<(String, String)>,
   body: Vec<u8>,
}

impl MockResponse {
   pub(crate) fn json(status: u16, body: Value) -> Self {
      Self {
         status,
         headers: vec![("Content-Type".into(), "application/json".into())],
         body: body.to_string().into_bytes(),
      }
   }

   pub(crate) fn text(status: u16, body: &str) -> Self {
      Self {
         status,
         headers: vec![("Content-Type".into(), "text/plain".into())],
         body: body.as_bytes().to_vec(),
      }
   }

   pub(crate) fn empty(status: u16) -> Self {
      Self {
         status,
         headers: Vec::new(),
         body: Vec::new(),
      }
   }

   pub(crate) fn header(mut self, name: &str, value: &str) -> Self {
      self.headers.push((name.to_string(), value.to_string()));
      self
   }
}

#[derive(Clone, Debug)]
pub(crate) struct RecordedRequest {
   pub method: String,
   pub path: String,
   pub query: String,
   pub headers: HashMap<String, String>,
   pub body: Vec<u8>,
}

impl RecordedRequest {
   pub(crate) fn json(&self) -> Value {
      serde_json::from_slice(&self.body).expect("request body should be JSON")
   }

   pub(crate) fn header(&self, name: &str) -> Option<&str> {
      self.headers.get(&name.to_lowercase()).map(String::as_str)
   }
}

struct Route {
   method: String,
   target: String,
   responses: Vec<MockResponse>,
}

#[derive(Default)]
struct State {
   routes: Vec<Route>,
   requests: Vec<RecordedRequest>,
}

pub(crate) struct MockGitHub {
   url: String,
   state: Arc<Mutex<State>>,
   stopped: Arc<AtomicBool>,
   address: std::net::SocketAddr,
   server: Option<thread::JoinHandle<()>>,
}

impl MockGitHub {
   pub(crate) fn start() -> Self {
      let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock GitHub server");
      let address = listener.local_addr().unwrap();
      let url = format!("http://{address}");
      let state = Arc::new(Mutex::new(State::default()));
      let stopped = Arc::new(AtomicBool::new(false));

      let server_state = Arc::clone(&state);
      let server_stopped = Arc::clone(&stopped);
      let server = thread::spawn(move || {
         for stream in listener.incoming() {
            if server_stopped.load(Ordering::SeqCst) {
               break;
            }
            let Ok(stream) = stream else { continue };
            let state = Arc::clone(&server_state);
            thread::spawn(move || handle_connection(stream, &state));
         }
      });

      BASE_URL.with(|base| *base.borrow_mut() = Some(url.clone()));
      Self {
         url,
         state,
         stopped,
         address,
         server: Some(server),
      }
   }

   pub(crate) fn url(&self) -> &str {
      &self.url
   }

   /// Answers `method target` with `responses` in order, repeating the last one afterwards.
   /// A `target` with a `?` only matches that exact query string.
   pub(crate) fn on(&self, method: &str, target: &str, responses: Vec<MockResponse>) -> &Self {
      assert!(!responses.is_empty());
      self.state.lock().unwrap().routes.push(Route {
         method: method.to_string(),
         target: target.to_string(),
         responses,
      });
      self
   }

   pub(crate) fn json(&self, method: &str, target: &str, body: Value) -> &Self {
      self.on(method, target, vec![MockResponse::json(200, body)])
   }

   pub(crate) fn requests(&self) -> Vec<RecordedRequest> {
      self.state.lock().unwrap().requests.clone()
   }

   pub(crate) fn request(&self, method: &str, path: &str) -> RecordedRequest {
      self
         .requests()
         .into_iter()
         .rev()
         .find(|request| request.method == method && request.path == path)
         .unwrap_or_else(|| panic!("no {method} {path} request was made"))
   }

   pub(crate) fn paths(&self) -> Vec<String> {
      self
         .requests()
         .into_iter()
         .map(|request| format!("{} {}", request.method, request.path))
         .collect()
   }
}

impl Drop for MockGitHub {
   fn drop(&mut self) {
      BASE_URL.with(|base| base.borrow_mut().take());
      self.stopped.store(true, Ordering::SeqCst);
      let _ = TcpStream::connect(self.address);
      if let Some(server) = self.server.take() {
         let _ = server.join();
      }
   }
}

fn respond(state: &Mutex<State>, request: &RecordedRequest) -> MockResponse {
   let mut state = state.lock().unwrap();
   let full_target = if request.query.is_empty() {
      request.path.clone()
   } else {
      format!("{}?{}", request.path, request.query)
   };
   let route = state.routes.iter_mut().rev().find(|route| {
      route.method == request.method
         && if route.target.contains('?') {
            route.target == full_target
         } else {
            route.target == request.path
         }
   });
   let response = match route {
      Some(route) if route.responses.len() > 1 => route.responses.remove(0),
      Some(route) => route.responses[0].clone(),
      None => MockResponse::json(404, serde_json::json!({ "message": "Not Found" })),
   };
   state.requests.push(request.clone());
   response
}

fn handle_connection(stream: TcpStream, state: &Mutex<State>) {
   let mut reader = BufReader::new(stream.try_clone().unwrap());
   let Some(request) = read_request(&mut reader) else {
      return;
   };
   let response = respond(state, &request);

   let mut head = format!(
      "HTTP/1.1 {} Mock\r\nContent-Length: {}\r\nConnection: close\r\n",
      response.status,
      response.body.len()
   );
   for (name, value) in &response.headers {
      head.push_str(&format!("{name}: {value}\r\n"));
   }
   head.push_str("\r\n");
   let mut stream = stream;
   let _ = stream.write_all(head.as_bytes());
   let _ = stream.write_all(&response.body);
   let _ = stream.flush();
}

fn read_request(reader: &mut impl BufRead) -> Option<RecordedRequest> {
   let mut request_line = String::new();
   if reader.read_line(&mut request_line).ok()? == 0 {
      return None;
   }
   let mut parts = request_line.split_whitespace();
   let method = parts.next()?.to_string();
   let target = parts.next()?.to_string();
   let (path, query) = target
      .split_once('?')
      .map(|(path, query)| (path.to_string(), query.to_string()))
      .unwrap_or((target.clone(), String::new()));

   let mut headers = HashMap::new();
   loop {
      let mut line = String::new();
      if reader.read_line(&mut line).ok()? == 0 {
         break;
      }
      let line = line.trim_end();
      if line.is_empty() {
         break;
      }
      if let Some((name, value)) = line.split_once(':') {
         headers.insert(name.trim().to_lowercase(), value.trim().to_string());
      }
   }

   let mut body = Vec::new();
   if let Some(length) = headers
      .get("content-length")
      .and_then(|value| value.parse::<usize>().ok())
   {
      body.resize(length, 0);
      reader.read_exact(&mut body).ok()?;
   } else if headers
      .get("transfer-encoding")
      .is_some_and(|value| value.eq_ignore_ascii_case("chunked"))
   {
      loop {
         let mut size_line = String::new();
         reader.read_line(&mut size_line).ok()?;
         let size = usize::from_str_radix(size_line.trim(), 16).ok()?;
         let mut chunk = vec![0; size + 2];
         reader.read_exact(&mut chunk).ok()?;
         if size == 0 {
            break;
         }
         body.extend_from_slice(&chunk[..size]);
      }
   }

   Some(RecordedRequest {
      method,
      path,
      query,
      headers,
      body,
   })
}
