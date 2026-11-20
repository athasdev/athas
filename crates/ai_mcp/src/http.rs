//! MCP over HTTP: Streamable HTTP (every message a POST, answered with JSON or an event stream)
//! and the older HTTP+SSE transport (one event stream for replies, POSTs to the endpoint it
//! names). Requests run on plain threads and their replies feed the connection like stdio lines.
//!
//! Ported from Athas's `intelligence/services/intelligence-mcp-transports.ts` and
//! `intelligence/lib/intelligence-mcp-client.ts` (`readServerSentEvents`).

#![cfg_attr(target_family = "wasm", allow(dead_code))]

use std::{io::BufRead, sync::Arc};

use serde_json::{Value, json};

use crate::{client::Connection, servers::McpServerConfig};

/// Reads server-sent events until the stream ends or `on_event` returns false; an event without
/// a name is a `message`.
pub(crate) fn read_events(reader: impl BufRead, mut on_event: impl FnMut(&str, &str) -> bool) {
    let mut event = String::new();
    let mut data: Vec<String> = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let line = line.strip_suffix('\r').unwrap_or(&line);
        if line.is_empty() {
            if !data.is_empty() && !on_event(if event.is_empty() { "message" } else { &event }, &data.join("\n")) {
                return;
            }
            event.clear();
            data.clear();
            continue;
        }
        if line.starts_with(':') {
            continue;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        match field {
            "event" => event = value.to_string(),
            "data" => data.push(value.to_string()),
            _ => {}
        }
    }
    if !data.is_empty() {
        on_event(if event.is_empty() { "message" } else { &event }, &data.join("\n"));
    }
}

/// `reference` resolved against `base`, as `new URL(reference, base)` does for the endpoint an
/// SSE server names.
pub(crate) fn join_url(base: &str, reference: &str) -> String {
    let reference = reference.trim();
    if reference.contains("://") {
        return reference.to_string();
    }
    let scheme_end = base.find("://").map_or(0, |index| index + 3);
    if let Some(rest) = reference.strip_prefix("//") {
        return format!("{}{rest}", &base[..scheme_end]);
    }
    let path_start = base[scheme_end..].find('/').map_or(base.len(), |index| scheme_end + index);
    if reference.starts_with('/') {
        return format!("{}{reference}", &base[..path_start]);
    }
    let without_query = base.split(['?', '#']).next().unwrap_or(base);
    let directory_end = without_query.rfind('/').filter(|index| *index >= path_start).map_or(without_query.len(), |index| index + 1);
    let directory = &without_query[..directory_end];
    if directory.ends_with('/') { format!("{directory}{reference}") } else { format!("{directory}/{reference}") }
}

/// The error reply a failed POST stands in for, so the waiting request fails with the reason.
pub(crate) fn failed_reply(message: &Value, reason: &str) -> Option<Value> {
    let id = message.get("id").filter(|id| !id.is_null())?;
    message.get("method")?;
    Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": reason } }))
}

fn url(config: &McpServerConfig) -> Result<String, String> {
    let url = config.setting.url.trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(url.to_string())
    } else {
        Err(format!("{}: the server URL must start with http:// or https://.", config.setting.name.trim()))
    }
}

#[cfg(not(target_family = "wasm"))]
mod native {
    use std::{
        io::{BufReader, Read as _},
        sync::{Mutex, Weak},
    };

    use super::*;

    fn headers(config: &McpServerConfig) -> Vec<(String, String)> {
        crate::servers::named_values(&config.secrets.headers).map(|(name, value)| (name.to_string(), value.to_string())).collect()
    }

    const MAX_BODY_BYTES: u64 = 8 * 1024 * 1024;

    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(std::time::Duration::from_secs(30)))
            .build()
            .into()
    }

    type Response = ureq::http::Response<ureq::Body>;

    fn request(agent: &ureq::Agent, method: &str, url: &str, headers: &[(String, String)], body: Option<String>) -> Result<Response, String> {
        let mut builder = ureq::http::Request::builder().method(method).uri(url);
        for (name, value) in headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let request = builder.body(body.unwrap_or_default()).map_err(|error| error.to_string())?;
        agent.run(request).map_err(|error| error.to_string())
    }

    fn header(response: &Response, name: &str) -> Option<String> {
        response.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_string)
    }

    fn body_text(response: Response) -> String {
        let mut text = String::new();
        let _ = response.into_body().into_reader().take(MAX_BODY_BYTES).read_to_string(&mut text);
        text
    }

    fn describe(response: Response) -> String {
        let status = response.status().as_u16();
        let body = body_text(response);
        let detail: String = body.trim().chars().take(300).collect();
        if detail.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {detail}") }
    }

    fn deliver(connection: &Weak<Connection>, text: &str) {
        if let Some(connection) = connection.upgrade() {
            connection.receive(text);
        }
    }

    fn fail(connection: &Weak<Connection>, message: &Value, reason: &str) {
        if let Some(reply) = failed_reply(message, reason) {
            deliver(connection, &reply.to_string());
        }
    }

    /// Ends the Streamable HTTP session when the client goes away.
    struct Session {
        url: String,
        headers: Vec<(String, String)>,
        id: Arc<Mutex<Option<String>>>,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            let Some(id) = self.id.lock().unwrap_or_else(|p| p.into_inner()).take() else { return };
            let url = std::mem::take(&mut self.url);
            let mut headers = std::mem::take(&mut self.headers);
            headers.push(("Mcp-Session-Id".into(), id));
            std::thread::spawn(move || {
                let _ = request(&agent(), "DELETE", &url, &headers, None);
            });
        }
    }

    pub(crate) fn connect_http(config: &McpServerConfig) -> Result<Arc<Connection>, String> {
        let url = url(config)?;
        let connection = Connection::new(config.setting.name.trim().to_string());
        let weak = Arc::downgrade(&connection);
        let agent = agent();
        let session = Session { url: url.clone(), headers: headers(config), id: Arc::default() };
        connection.set_sender(Box::new(move |message| {
            let mut headers = session.headers.clone();
            if let Some(id) = session.id.lock().unwrap_or_else(|p| p.into_inner()).clone() {
                headers.push(("Mcp-Session-Id".into(), id));
            }
            if let Some(version) = weak.upgrade().and_then(|connection| connection.protocol_version.lock().unwrap_or_else(|p| p.into_inner()).clone()) {
                headers.push(("MCP-Protocol-Version".into(), version));
            }
            headers.push(("Content-Type".into(), "application/json".into()));
            headers.push(("Accept".into(), "application/json, text/event-stream".into()));
            let (agent, url, weak, session_id, message) = (agent.clone(), url.clone(), weak.clone(), session.id.clone(), message.clone());
            std::thread::spawn(move || {
                let response = match request(&agent, "POST", &url, &headers, Some(message.to_string())) {
                    Ok(response) => response,
                    Err(error) => return fail(&weak, &message, &error),
                };
                if let Some(id) = header(&response, "mcp-session-id") {
                    *session_id.lock().unwrap_or_else(|p| p.into_inner()) = Some(id);
                }
                if !response.status().is_success() {
                    return fail(&weak, &message, &describe(response));
                }
                if header(&response, "content-type").is_some_and(|kind| kind.contains("text/event-stream")) {
                    let reader = BufReader::new(response.into_body().into_reader());
                    read_events(reader, |event, data| {
                        if event == "message" {
                            deliver(&weak, data);
                        }
                        weak.strong_count() > 0
                    });
                    return;
                }
                deliver(&weak, &body_text(response));
            });
            Ok(())
        }));
        Ok(connection)
    }

    pub(crate) async fn connect_sse(config: &McpServerConfig) -> Result<Arc<Connection>, String> {
        let url = url(config)?;
        let name = config.setting.name.trim().to_string();
        let connection = Connection::new(name.clone());
        let weak = Arc::downgrade(&connection);
        let headers = headers(config);
        let agent = agent();
        let (ready_tx, ready_rx) = futures::channel::oneshot::channel::<Result<String, String>>();
        {
            let (agent, url, headers, weak) = (agent.clone(), url.clone(), headers.clone(), weak.clone());
            std::thread::spawn(move || {
                let mut get_headers = headers;
                get_headers.push(("Accept".into(), "text/event-stream".into()));
                let response = match request(&agent, "GET", &url, &get_headers, None) {
                    Ok(response) if response.status().is_success() => response,
                    Ok(response) => {
                        let _ = ready_tx.send(Err(format!("{name}: {}", describe(response))));
                        return;
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(format!("{name}: {error}")));
                        return;
                    }
                };
                let mut ready = Some(ready_tx);
                read_events(BufReader::new(response.into_body().into_reader()), |event, data| {
                    match event {
                        "endpoint" => {
                            if let Some(ready) = ready.take() {
                                let _ = ready.send(Ok(join_url(&url, data)));
                            }
                        }
                        "message" => deliver(&weak, data),
                        _ => {}
                    }
                    weak.strong_count() > 0 || ready.is_some()
                });
                match ready {
                    Some(ready) => {
                        let _ = ready.send(Err(format!("{name}: the server closed the event stream before it was ready.")));
                    }
                    None => {
                        if let Some(connection) = weak.upgrade() {
                            connection.close(format!("{name} stopped: the event stream ended."));
                        }
                    }
                }
            });
        }
        let endpoint = ready_rx.await.unwrap_or_else(|_| Err(format!("{} could not connect.", connection.name)))?;
        connection.set_sender(Box::new(move |message| {
            let mut headers = headers.clone();
            headers.push(("Content-Type".into(), "application/json".into()));
            let (agent, endpoint, weak, message) = (agent.clone(), endpoint.clone(), weak.clone(), message.clone());
            std::thread::spawn(move || match request(&agent, "POST", &endpoint, &headers, Some(message.to_string())) {
                Ok(response) if response.status().is_success() => {
                    body_text(response);
                }
                Ok(response) => fail(&weak, &message, &describe(response)),
                Err(error) => fail(&weak, &message, &error),
            });
            Ok(())
        }));
        Ok(connection)
    }
}

#[cfg(not(target_family = "wasm"))]
pub(crate) use native::{connect_http, connect_sse};

#[cfg(target_family = "wasm")]
pub(crate) fn connect_http(config: &McpServerConfig) -> Result<Arc<Connection>, String> {
    url(config)?;
    Err(format!("{}: HTTP MCP servers are not available in the browser.", config.setting.name.trim()))
}

#[cfg(target_family = "wasm")]
pub(crate) async fn connect_sse(config: &McpServerConfig) -> Result<Arc<Connection>, String> {
    connect_http(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_read_with_their_names() {
        let stream = ": comment\nevent: endpoint\ndata: /messages?session=1\n\ndata: {\"a\":\ndata: 1}\n\ndata: tail";
        let mut events = Vec::new();
        read_events(stream.as_bytes(), |event, data| {
            events.push((event.to_string(), data.to_string()));
            true
        });
        assert_eq!(
            events,
            [("endpoint".into(), "/messages?session=1".into()), ("message".into(), "{\"a\":\n1}".into()), ("message".into(), "tail".into())]
        );
    }

    #[test]
    fn endpoints_resolve_against_the_server_url() {
        assert_eq!(join_url("https://mcp.example.com/sse", "/messages?s=1"), "https://mcp.example.com/messages?s=1");
        assert_eq!(join_url("https://mcp.example.com/v1/sse?x=1", "messages"), "https://mcp.example.com/v1/messages");
        assert_eq!(join_url("https://mcp.example.com", "messages"), "https://mcp.example.com/messages");
        assert_eq!(join_url("https://a.example/sse", "https://b.example/post"), "https://b.example/post");
        assert_eq!(join_url("https://a.example/sse", "//b.example/post"), "https://b.example/post");
    }

    #[test]
    fn a_failed_request_fails_its_caller() {
        let reply = failed_reply(&json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" }), "HTTP 500").unwrap();
        assert_eq!(reply["error"]["message"], "HTTP 500");
        assert_eq!(reply["id"], 3);
        assert_eq!(failed_reply(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), "x"), None);
        assert_eq!(failed_reply(&json!({ "jsonrpc": "2.0", "id": 1, "result": {} }), "x"), None);
    }

    #[cfg(not(target_family = "wasm"))]
    mod servers {
        use std::{
            io::{BufReader, Read, Write},
            net::{TcpListener, TcpStream},
            sync::{Mutex, mpsc},
        };

        use futures::executor::block_on;

        use super::*;
        use crate::{McpClient, McpNameValue, McpServerConfig, McpServerSecrets, McpServerSetting, McpTransportKind};

        struct Request {
            method: String,
            path: String,
            headers: Vec<(String, String)>,
            body: Value,
        }

        fn read_request(stream: &TcpStream) -> Option<Request> {
            let mut reader = BufReader::new(stream.try_clone().ok()?);
            let mut line = String::new();
            reader.read_line(&mut line).ok()?;
            let mut parts = line.split_whitespace();
            let (method, path) = (parts.next()?.to_string(), parts.next()?.to_string());
            let mut headers = Vec::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).ok()?;
                let line = line.trim_end();
                if line.is_empty() {
                    break;
                }
                let (name, value) = line.split_once(':')?;
                headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
            let length = headers.iter().find(|(name, _)| name == "content-length").and_then(|(_, value)| value.parse().ok()).unwrap_or(0);
            let mut body = vec![0; length];
            reader.read_exact(&mut body).ok()?;
            Some(Request { method, path, headers, body: serde_json::from_slice(&body).unwrap_or(Value::Null) })
        }

        fn respond(mut stream: &TcpStream, status: &str, headers: &[(&str, &str)], body: &str) {
            let mut head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
            for (name, value) in headers {
                head.push_str(&format!("{name}: {value}\r\n"));
            }
            let _ = write!(stream, "{head}\r\n{body}");
        }

        fn header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
            request.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
        }

        fn config(transport: McpTransportKind, url: String) -> McpServerConfig {
            McpServerConfig {
                setting: McpServerSetting { id: "web".into(), name: "Web".into(), enabled: true, transport, command: String::new(), args: Vec::new(), url },
                secrets: McpServerSecrets { env: Vec::new(), headers: vec![McpNameValue { name: "Authorization".into(), value: "Bearer t".into() }] },
            }
        }

        fn reply(request: &Request, result: Value) -> String {
            json!({ "jsonrpc": "2.0", "id": request.body["id"], "result": result }).to_string()
        }

        #[test]
        fn streamable_http_keeps_the_session_and_reads_json_and_streams() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/mcp", listener.local_addr().unwrap());
            let (seen_tx, seen) = mpsc::channel::<(String, Option<String>, Option<String>, Option<String>)>();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { break };
                    let seen_tx = seen_tx.clone();
                    std::thread::spawn(move || {
                        let Some(request) = read_request(&stream) else { return };
                        let method = request.body["method"].as_str().unwrap_or(&request.method).to_string();
                        let _ = seen_tx.send((
                            method.clone(),
                            header(&request, "mcp-session-id").map(str::to_string),
                            header(&request, "mcp-protocol-version").map(str::to_string),
                            header(&request, "authorization").map(str::to_string),
                        ));
                        match method.as_str() {
                            "initialize" => respond(&stream, "200 OK", &[("Content-Type", "application/json"), ("Mcp-Session-Id", "s1")], &reply(&request, json!({ "protocolVersion": "2025-03-26" }))),
                            "tools/list" => {
                                let body = format!("event: message\ndata: {}\n\n", reply(&request, json!({ "tools": [{ "name": "fetch" }] })));
                                respond(&stream, "200 OK", &[("Content-Type", "text/event-stream")], &body)
                            }
                            "tools/call" => respond(&stream, "500 Internal Server Error", &[], "boom"),
                            _ => respond(&stream, "202 Accepted", &[], ""),
                        }
                    });
                }
            });
            let client = block_on(McpClient::start(&config(McpTransportKind::Http, url), None, |_| None)).unwrap();
            assert_eq!(block_on(client.list_tools()).unwrap()[0].name, "fetch");
            assert_eq!(block_on(client.call_tool("fetch", json!({}))).unwrap_err(), "HTTP 500: boom");
            drop(client);
            let mut requests = Vec::new();
            while let Ok(request) = seen.recv_timeout(std::time::Duration::from_secs(5)) {
                let done = request.0 == "DELETE";
                requests.push(request);
                if done {
                    break;
                }
            }
            let find = |method: &str| requests.iter().find(|request| request.0 == method).cloned().unwrap();
            assert_eq!(find("initialize").1, None);
            assert_eq!(find("initialize").3.as_deref(), Some("Bearer t"));
            let list = find("tools/list");
            assert_eq!((list.1.as_deref(), list.2.as_deref()), (Some("s1"), Some("2025-03-26")));
            assert_eq!(find("DELETE").1.as_deref(), Some("s1"));
        }

        #[test]
        fn sse_replies_arrive_on_the_event_stream() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/sse", listener.local_addr().unwrap());
            let stream_out: std::sync::Arc<Mutex<Option<TcpStream>>> = Default::default();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { break };
                    let stream_out = stream_out.clone();
                    std::thread::spawn(move || {
                        let Some(request) = read_request(&stream) else { return };
                        if request.method == "GET" {
                            let mut out = stream.try_clone().unwrap();
                            let _ = write!(out, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nevent: endpoint\ndata: /messages?session=9\n\n");
                            let _ = out.flush();
                            *stream_out.lock().unwrap() = Some(out);
                            return;
                        }
                        assert_eq!(request.path, "/messages?session=9");
                        let answer = match request.body["method"].as_str() {
                            Some("initialize") => Some(reply(&request, json!({}))),
                            Some("tools/list") => Some(reply(&request, json!({ "tools": [{ "name": "search" }] }))),
                            Some("tools/call") => {
                                respond(&stream, "403 Forbidden", &[], "");
                                return;
                            }
                            _ => None,
                        };
                        respond(&stream, "202 Accepted", &[], "");
                        if let Some(answer) = answer
                            && let Some(out) = stream_out.lock().unwrap().as_mut()
                        {
                            let _ = write!(out, "event: message\ndata: {answer}\n\n");
                            let _ = out.flush();
                        }
                    });
                }
            });
            let client = block_on(McpClient::start(&config(McpTransportKind::Sse, url), None, |_| None)).unwrap();
            assert_eq!(block_on(client.list_tools()).unwrap()[0].name, "search");
            assert_eq!(block_on(client.call_tool("search", json!({}))).unwrap_err(), "HTTP 403");
        }

        #[test]
        fn a_server_url_must_be_http() {
            let error = block_on(McpClient::start(&config(McpTransportKind::Http, "ftp://x".into()), None, |_| None)).err().unwrap();
            assert_eq!(error, "Web: the server URL must start with http:// or https://.");
        }
    }
}
