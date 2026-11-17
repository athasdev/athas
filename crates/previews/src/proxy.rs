//! Answering a visitor's request from the local server (`preview-proxy.ts`): only
//! `http://localhost:<port>`, hop-by-hop headers dropped, redirects to the local server turned
//! into paths, the body sent in chunks, and nothing sent once the visitor went away.

use std::{
    io::Read as _,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use crate::protocol::{DesktopFrame, HeaderList, TunnelRequest};

/// The Worker cuts responses off past this, so the app stops reading there too.
pub const MAX_RESPONSE_BYTES: usize = 25 * 1024 * 1024;
/// Body bytes per frame; the Worker accepts up to 1 MB.
pub const BODY_CHUNK_BYTES: usize = 256 * 1024;
/// How long the local server may take to start answering, and between body chunks.
const LOCAL_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

const METHODS: [&str; 7] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const HOP_BY_HOP: [&str; 11] =
    ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"];

pub fn is_valid_port(port: u32) -> bool {
    (1..=65_535).contains(&port)
}

/// The port typed into the share dialog, or `None` until it is a whole number from 1 to 65535.
pub fn parse_port_input(value: &str) -> Option<u16> {
    let value = value.trim();
    if value.is_empty() || value.len() > 5 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse::<u32>().ok().filter(|port| is_valid_port(*port)).map(|port| port as u16)
}

/// The URL a visitor's path maps to on this computer: always `http://localhost:<port>`, never
/// another host, whatever the path tries (`//host`, `\\host`, absolute URLs).
pub fn local_target_url(port: u16, path: &str) -> Option<String> {
    if port == 0 || !path.starts_with('/') || path.starts_with("//") || path.contains('\\') {
        return None;
    }
    if path.chars().any(|character| (character as u32) < 0x20 || character as u32 == 0x7f) {
        return None;
    }
    let base = format!("http://localhost:{port}");
    let url = url::Url::parse(&base).ok()?.join(path).ok()?;
    (url.origin().ascii_serialization() == base).then(|| url.to_string())
}

/// The headers the local server gets: the visitor's minus hop-by-hop ones, asking for an
/// unencoded body.
pub fn headers_for_local_server(headers: &HeaderList) -> HeaderList {
    let mut list: HeaderList = headers
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
        .filter(|(name, _)| !HOP_BY_HOP.contains(&name.as_str()) && name != "accept-encoding")
        .collect();
    list.push(("accept-encoding".into(), "identity".into()));
    list
}

/// Redirects to the local server itself become paths, so the visitor stays on the preview.
pub fn rewrite_location(location: &str, port: u16) -> String {
    for host in [format!("localhost:{port}"), format!("127.0.0.1:{port}"), format!("[::1]:{port}")] {
        for scheme in ["http://", "https://"] {
            let prefix = format!("{scheme}{host}");
            if location == prefix {
                return "/".into();
            }
            if let Some(rest) = location.strip_prefix(&prefix)
                && (rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('#'))
            {
                return if rest.starts_with('/') { rest.to_string() } else { format!("/{rest}") };
            }
        }
    }
    location.to_string()
}

/// The headers sent back to the visitor.
pub fn headers_for_visitor(headers: &[(String, String)], port: u16) -> HeaderList {
    headers
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
        .filter(|(name, _)| !HOP_BY_HOP.contains(&name.as_str()))
        .map(|(name, value)| {
            let value = if name == "location" { rewrite_location(&value, port) } else { value };
            (name, value)
        })
        .collect()
}

#[derive(Debug, PartialEq)]
pub enum ProxyResult {
    Answered { status: u16, bytes: usize },
    Failed(String),
    Cancelled,
}

/// Answers one visitor request from the local server on `port`: the response status and
/// headers, the body in chunks and `end`, or `error` when the server cannot be reached, answers
/// too slowly or sends more than a preview may carry. Redirects are never followed; once
/// `cancelled` is set nothing more is sent.
pub fn proxy_local_request(request: &TunnelRequest, body: &[u8], port: u16, cancelled: &AtomicBool, send: &dyn Fn(DesktopFrame, &[u8])) -> ProxyResult {
    let fail = |message: String| {
        if !cancelled.load(Ordering::Relaxed) {
            send(DesktopFrame::Error { id: request.id.clone(), message: message.clone() }, &[]);
        }
        ProxyResult::Failed(message)
    };
    let Some(url) = local_target_url(port, &request.path) else { return fail("The request path is not allowed.".into()) };
    let method = request.method.to_ascii_uppercase();
    if !METHODS.contains(&method.as_str()) {
        return fail("The request method is not allowed.".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_recv_response(Some(LOCAL_RESPONSE_TIMEOUT))
        .timeout_recv_body(Some(LOCAL_RESPONSE_TIMEOUT))
        .build()
        .into();
    let mut builder = ureq::http::Request::builder().method(method.as_str()).uri(&url);
    for (name, value) in headers_for_local_server(&request.headers) {
        builder = builder.header(name, value);
    }
    let payload = if method == "GET" || method == "HEAD" { Vec::new() } else { body.to_vec() };
    let Ok(http_request) = builder.body(payload) else { return fail("The request is not valid.".into()) };
    let response = match agent.run(http_request) {
        Ok(response) => response,
        Err(ureq::Error::Timeout(_)) => return fail(format!("The server on port {port} did not answer in time.")),
        Err(_) if cancelled.load(Ordering::Relaxed) => return ProxyResult::Cancelled,
        Err(_) => return fail(format!("Nothing answered on localhost:{port}. Is the dev server running?")),
    };
    if cancelled.load(Ordering::Relaxed) {
        return ProxyResult::Cancelled;
    }
    let status = response.status().as_u16();
    let headers: Vec<(String, String)> =
        response.headers().iter().map(|(name, value)| (name.to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned())).collect();
    send(DesktopFrame::Response { id: request.id.clone(), status, headers: headers_for_visitor(&headers, port) }, &[]);

    let mut bytes = 0;
    if method != "HEAD" {
        let mut reader = response.into_body().into_reader();
        let mut buffer = vec![0; BODY_CHUNK_BYTES];
        loop {
            let read = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(_) if cancelled.load(Ordering::Relaxed) => return ProxyResult::Cancelled,
                Err(_) => return fail(format!("The server on port {port} stopped sending its response.")),
            };
            if cancelled.load(Ordering::Relaxed) {
                return ProxyResult::Cancelled;
            }
            bytes += read;
            if bytes > MAX_RESPONSE_BYTES {
                return fail("The response is larger than a preview may send.".into());
            }
            send(DesktopFrame::Body { id: request.id.clone() }, &buffer[..read]);
        }
    }
    send(DesktopFrame::End { id: request.id.clone() }, &[]);
    ProxyResult::Answered { status, bytes }
}

/// Ports dev servers commonly use: Next.js, Vite, Astro, Angular, Django, Rails, and others.
pub const COMMON_DEV_PORTS: [u16; 13] = [3000, 3001, 4000, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8787, 8888];

/// The common dev ports where something answers HTTP on localhost, whatever its status.
pub fn detect_local_ports(ports: &[u16], timeout: Duration) -> Vec<u16> {
    let handles: Vec<_> = ports
        .iter()
        .map(|port| {
            let port = *port;
            std::thread::spawn(move || {
                let agent: ureq::Agent = ureq::Agent::config_builder()
                    .max_redirects(0)
                    .http_status_as_error(false)
                    .timeout_global(Some(timeout))
                    .build()
                    .into();
                agent.get(&format!("http://localhost:{port}/")).call().is_ok().then_some(port)
            })
        })
        .collect();
    handles.into_iter().filter_map(|handle| handle.join().ok().flatten()).collect()
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write as _,
        net::TcpListener,
        sync::Mutex,
    };

    use super::*;

    #[test]
    fn keeps_visitors_on_localhost() {
        assert_eq!(local_target_url(5173, "/a?b=1").as_deref(), Some("http://localhost:5173/a?b=1"));
        assert_eq!(local_target_url(5173, "//evil.com/"), None);
        assert_eq!(local_target_url(5173, "/\\evil"), None);
        assert_eq!(local_target_url(5173, "http://evil.com/"), None);
        assert_eq!(local_target_url(5173, "/a\nb"), None);
        assert_eq!(parse_port_input(" 5173 "), Some(5173));
        assert_eq!(parse_port_input("70000"), None);
        assert_eq!(parse_port_input("51a"), None);
    }

    #[test]
    fn filters_headers_and_rewrites_redirects() {
        let sent = headers_for_local_server(&vec![("Host".into(), "x".into()), ("Accept-Encoding".into(), "gzip".into()), ("Cookie".into(), "a=1".into())]);
        assert_eq!(sent, vec![("cookie".to_string(), "a=1".to_string()), ("accept-encoding".to_string(), "identity".to_string())]);
        assert_eq!(rewrite_location("http://localhost:3000/login?next=1", 3000), "/login?next=1");
        assert_eq!(rewrite_location("http://127.0.0.1:3000", 3000), "/");
        assert_eq!(rewrite_location("http://localhost:3000?x", 3000), "/?x");
        assert_eq!(rewrite_location("https://example.com/", 3000), "https://example.com/");
        let back = headers_for_visitor(&[("Location".into(), "http://localhost:3000/a".into()), ("Transfer-Encoding".into(), "chunked".into())], 3000);
        assert_eq!(back, vec![("location".to_string(), "/a".to_string())]);
    }

    /// A one-shot HTTP server on a free port, answering with `response`.
    fn serve_once(response: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0; 4096];
                let _ = stream.read(&mut buffer);
                stream.write_all(response).ok();
            }
        });
        port
    }

    #[test]
    fn proxies_a_request_to_a_local_server() {
        let port = serve_once(b"HTTP/1.1 302 Found\r\nLocation: http://localhost:1/x\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello");
        let frames = Mutex::new(Vec::new());
        let request = TunnelRequest { id: "r".into(), method: "GET".into(), path: "/".into(), headers: Vec::new() };
        let result = proxy_local_request(&request, &[], port, &AtomicBool::new(false), &|frame, payload| frames.lock().unwrap().push((frame, payload.to_vec())));
        assert_eq!(result, ProxyResult::Answered { status: 302, bytes: 5 });
        let frames = frames.into_inner().unwrap();
        assert!(matches!(&frames[0].0, DesktopFrame::Response { status: 302, .. }));
        assert_eq!(frames[1], (DesktopFrame::Body { id: "r".into() }, b"hello".to_vec()));
        assert_eq!(frames.last().unwrap().0, DesktopFrame::End { id: "r".into() });
    }

    #[test]
    fn reports_a_server_that_is_not_running() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let frames = Mutex::new(Vec::new());
        let request = TunnelRequest { id: "r".into(), method: "GET".into(), path: "/".into(), headers: Vec::new() };
        let result = proxy_local_request(&request, &[], port, &AtomicBool::new(false), &|frame, _| frames.lock().unwrap().push(frame));
        assert!(matches!(result, ProxyResult::Failed(_)));
        assert!(matches!(&frames.into_inner().unwrap()[0], DesktopFrame::Error { .. }));
    }
}
