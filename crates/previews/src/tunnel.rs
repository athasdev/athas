//! A local preview's tunnel to the athas-cloud Worker (`preview-tunnel.ts`): answers the visitor
//! requests that arrive on it from `http://localhost:<port>`, renews its token over the socket
//! before it expires, reconnects with backoff, and ends once the preview is stopped, expires or
//! is taken over by another connection.

use std::{
    collections::HashMap,
    net::TcpStream,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    time::{Duration, Instant},
};

use tungstenite::{Message, WebSocket, protocol::CloseFrame, stream::MaybeTlsStream};

use crate::{
    PreviewTicket,
    protocol::{DesktopFrame, PREVIEW_ENDED_CLOSE_CODE, ServerFrame, TUNNEL_REPLACED_CLOSE_CODE, TUNNEL_TOKEN_EXPIRED_CLOSE_CODE, encode_frame, parse_server_frame},
    proxy::{self, ProxyResult},
};

const RECONNECT_BASE: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(30);
const KEEPALIVE: Duration = Duration::from_secs(25);
const TICKET_REFRESH_MARGIN_MS: i64 = 60_000;
/// Requests answered at once; the Worker queues at most 64 per preview.
const MAX_CONCURRENT_REQUESTS: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TunnelStatus {
    Connecting,
    Open,
    Reconnecting,
    Ended,
}

impl TunnelStatus {
    pub fn label(self) -> &'static str {
        match self {
            TunnelStatus::Connecting => "Connecting",
            TunnelStatus::Open => "Live",
            TunnelStatus::Reconnecting => "Reconnecting",
            TunnelStatus::Ended => "Stopped",
        }
    }
}

pub enum TunnelEvent {
    Status(TunnelStatus),
    /// A visitor request was answered (with its status) or failed.
    Request { status: Option<u16> },
}

/// Why a new ticket could not be had.
pub enum TicketError {
    /// The account service says the preview is over.
    Ended,
    Failed,
}

pub type TicketSource = Box<dyn Fn() -> Result<PreviewTicket, TicketError> + Send>;

/// `base * 2^(attempt-1)` up to 30 s, with ±25 % jitter.
pub fn reconnect_delay(attempt: u32, random: f64) -> Duration {
    let base = RECONNECT_BASE.saturating_mul(1 << attempt.saturating_sub(1).min(16)).min(RECONNECT_MAX);
    base.mul_f64(0.75 + random * 0.5)
}

fn random_unit() -> f64 {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|elapsed| elapsed.subsec_nanos()).unwrap_or(0);
    (nanos % 1000) as f64 / 1000.
}

fn expires_ms(ticket: &PreviewTicket) -> i64 {
    chrono::DateTime::parse_from_rfc3339(&ticket.expires_at).map(|date| date.timestamp_millis()).unwrap_or(0)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The open tunnel; dropping it does not close it, `close` does.
pub struct Tunnel {
    closer: Sender<()>,
}

impl Tunnel {
    pub fn close(&self) {
        self.closer.send(()).ok();
    }
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

struct Runner {
    port: u16,
    ticket: Option<PreviewTicket>,
    tickets: TicketSource,
    events: Box<dyn Fn(TunnelEvent) + Send>,
    closer: Receiver<()>,
    status: TunnelStatus,
    attempts: u32,
    closed: bool,
}

pub fn connect(port: u16, ticket: PreviewTicket, tickets: TicketSource, events: impl Fn(TunnelEvent) + Send + 'static) -> Tunnel {
    let (closer, receiver) = mpsc::channel();
    let runner = Runner {
        port,
        ticket: Some(ticket),
        tickets,
        events: Box::new(events),
        closer: receiver,
        status: TunnelStatus::Connecting,
        attempts: 0,
        closed: false,
    };
    std::thread::Builder::new().name("preview-tunnel".into()).spawn(move || runner.run()).ok();
    Tunnel { closer }
}

impl Runner {
    fn set_status(&mut self, status: TunnelStatus) {
        if self.status != status {
            self.status = status;
            (self.events)(TunnelEvent::Status(status));
        }
    }

    fn run(mut self) {
        (self.events)(TunnelEvent::Status(self.status));
        while !self.closed {
            let Some(ticket) = self.current_ticket() else { break };
            let ended = match tungstenite::connect(ticket.url.as_str()) {
                Ok((mut socket, _)) => {
                    if let MaybeTlsStream::Plain(stream) = socket.get_mut() {
                        stream.set_read_timeout(Some(Duration::from_millis(100))).ok();
                    }
                    #[allow(unreachable_patterns)]
                    if let MaybeTlsStream::Rustls(stream) = socket.get_mut() {
                        stream.get_mut().set_read_timeout(Some(Duration::from_millis(100))).ok();
                    }
                    self.serve(socket, ticket)
                }
                Err(_) => false,
            };
            if ended || self.closed || !self.wait_to_reconnect() {
                break;
            }
        }
        self.set_status(TunnelStatus::Ended);
    }

    fn current_ticket(&mut self) -> Option<PreviewTicket> {
        loop {
            if let Some(ticket) = self.ticket.clone().filter(|ticket| expires_ms(ticket) - TICKET_REFRESH_MARGIN_MS / 2 > now_ms()) {
                return Some(ticket);
            }
            match (self.tickets)() {
                Ok(ticket) => {
                    self.ticket = Some(ticket.clone());
                    return Some(ticket);
                }
                Err(TicketError::Ended) => return None,
                Err(TicketError::Failed) => {
                    if !self.wait_to_reconnect() {
                        return None;
                    }
                }
            }
        }
    }

    fn wait_to_reconnect(&mut self) -> bool {
        self.attempts += 1;
        self.set_status(TunnelStatus::Reconnecting);
        match self.closer.recv_timeout(reconnect_delay(self.attempts, random_unit())) {
            Err(RecvTimeoutError::Timeout) => true,
            _ => {
                self.closed = true;
                false
            }
        }
    }

    /// Serves one connection; `true` when the preview is over for good.
    fn serve(&mut self, mut socket: Socket, ticket: PreviewTicket) -> bool {
        let (outgoing, frames) = mpsc::channel::<Vec<u8>>();
        let (finished, done) = mpsc::channel::<(String, Option<u16>)>();
        let mut in_flight: HashMap<String, Arc<AtomicBool>> = HashMap::new();
        let mut welcomed = false;
        let mut last_ping = Instant::now();
        let mut refresh_at = expires_ms(&ticket) - TICKET_REFRESH_MARGIN_MS;
        let cancel_all = |in_flight: &mut HashMap<String, Arc<AtomicBool>>| {
            for cancelled in in_flight.values() {
                cancelled.store(true, Ordering::Relaxed);
            }
            in_flight.clear();
        };
        loop {
            if self.closer.try_recv().is_ok() {
                self.closed = true;
                cancel_all(&mut in_flight);
                socket.close(Some(CloseFrame { code: 1000.into(), reason: "Closed".into() })).ok();
                socket.flush().ok();
                return true;
            }
            while let Ok(frame) = frames.try_recv() {
                socket.send(Message::binary(frame)).ok();
            }
            while let Ok((id, status)) = done.try_recv() {
                if in_flight.remove(&id).is_some() {
                    (self.events)(TunnelEvent::Request { status });
                }
            }
            if last_ping.elapsed() >= KEEPALIVE {
                last_ping = Instant::now();
                if socket.send(Message::text("ping")).is_err() {
                    break;
                }
            }
            if now_ms() >= refresh_at {
                refresh_at = now_ms() + RECONNECT_MAX.as_millis() as i64;
                match (self.tickets)() {
                    Ok(next) => {
                        refresh_at = expires_ms(&next) - TICKET_REFRESH_MARGIN_MS;
                        if let Some(token) = next.token() {
                            socket.send(Message::binary(encode_frame(&DesktopFrame::Renew { token }, &[]))).ok();
                        }
                        self.ticket = Some(next);
                    }
                    Err(TicketError::Ended) => {
                        self.closed = true;
                        cancel_all(&mut in_flight);
                        socket.close(None).ok();
                        return true;
                    }
                    Err(TicketError::Failed) => {}
                }
            }
            match socket.read() {
                Ok(Message::Binary(bytes)) => match parse_server_frame(&bytes) {
                    Some((ServerFrame::Welcome { .. }, _)) => {
                        welcomed = true;
                        self.attempts = 0;
                        self.set_status(TunnelStatus::Open);
                    }
                    Some((ServerFrame::Request(request), payload)) => {
                        if in_flight.len() >= MAX_CONCURRENT_REQUESTS {
                            let error = DesktopFrame::Error { id: request.id.clone(), message: "Too many requests at once.".into() };
                            socket.send(Message::binary(encode_frame(&error, &[]))).ok();
                            continue;
                        }
                        let cancelled = Arc::new(AtomicBool::new(false));
                        in_flight.insert(request.id.clone(), cancelled.clone());
                        let (outgoing, finished, body, port) = (outgoing.clone(), finished.clone(), payload.to_vec(), self.port);
                        std::thread::spawn(move || {
                            let send = |frame: DesktopFrame, payload: &[u8]| {
                                if !cancelled.load(Ordering::Relaxed) {
                                    outgoing.send(encode_frame(&frame, payload)).ok();
                                }
                            };
                            let status = match proxy::proxy_local_request(&request, &body, port, &cancelled, &send) {
                                ProxyResult::Answered { status, .. } => Some(status),
                                _ => None,
                            };
                            finished.send((request.id, status)).ok();
                        });
                    }
                    Some((ServerFrame::Cancel { id }, _)) => {
                        if let Some(cancelled) = in_flight.remove(&id) {
                            cancelled.store(true, Ordering::Relaxed);
                        }
                    }
                    Some((ServerFrame::Notice { message }, _)) => eprintln!("previews: {message}"),
                    Some((ServerFrame::Renewed { .. }, _)) | None => {}
                },
                Ok(Message::Text(text)) if text.as_str() == "ping" => {
                    socket.send(Message::text("pong")).ok();
                }
                Ok(Message::Close(frame)) => {
                    cancel_all(&mut in_flight);
                    let code = frame.map(|frame| u16::from(frame.code));
                    if matches!(code, Some(PREVIEW_ENDED_CLOSE_CODE | TUNNEL_REPLACED_CLOSE_CODE)) {
                        return true;
                    }
                    // A refused connection may mean the preview ended; a fresh ticket tells.
                    if code == Some(TUNNEL_TOKEN_EXPIRED_CLOSE_CODE) || !welcomed {
                        self.ticket = None;
                    }
                    return false;
                }
                Ok(_) => {}
                Err(tungstenite::Error::Io(error)) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                Err(_) => break,
            }
        }
        cancel_all(&mut in_flight);
        if !welcomed {
            self.ticket = None;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_up_to_thirty_seconds() {
        assert_eq!(reconnect_delay(1, 0.5), Duration::from_secs(1));
        assert_eq!(reconnect_delay(3, 0.5), Duration::from_secs(4));
        assert_eq!(reconnect_delay(20, 0.5), Duration::from_secs(30));
        assert_eq!(reconnect_delay(1, 0.), Duration::from_millis(750));
    }

    /// A mock Worker: welcomes the tunnel, sends one visitor request, reads the answer, then
    /// ends the preview.
    #[test]
    fn serves_a_visitor_request_through_a_mock_worker() {
        use std::{
            io::{Read as _, Write as _},
            net::TcpListener,
        };

        let local = TcpListener::bind("127.0.0.1:0").unwrap();
        let local_port = local.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = local.accept().unwrap();
            let mut request = [0u8; 2048];
            let read = stream.read(&mut request).unwrap();
            let path_ok = String::from_utf8_lossy(&request[..read]).starts_with("GET /hello ");
            let body = if path_ok { "hi there" } else { "wrong path" };
            write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).unwrap();
        });

        let worker = TcpListener::bind("127.0.0.1:0").unwrap();
        let worker_port = worker.local_addr().unwrap().port();
        let (seen_tx, seen_rx) = mpsc::channel::<(String, Vec<u8>)>();
        std::thread::spawn(move || {
            let (stream, _) = worker.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let frame = |header: serde_json::Value| {
                let json = serde_json::to_vec(&header).unwrap();
                let mut bytes = (json.len() as u32).to_be_bytes().to_vec();
                bytes.extend(json);
                Message::binary(bytes)
            };
            socket.send(frame(serde_json::json!({ "type": "welcome", "preview": "p1", "expiresAt": "2999-01-01T00:00:00Z" }))).unwrap();
            socket.send(frame(serde_json::json!({ "type": "request", "id": "r1", "method": "GET", "path": "/hello", "headers": [] }))).unwrap();
            loop {
                let bytes = match socket.read() {
                    Ok(Message::Binary(bytes)) => bytes,
                    Ok(_) => continue,
                    Err(_) => break,
                };
                let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
                let header: serde_json::Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
                let kind = header["type"].as_str().unwrap().to_string();
                let done = kind == "end" || kind == "error";
                seen_tx.send((if kind == "response" { format!("response {}", header["status"]) } else { kind }, bytes[4 + length..].to_vec())).unwrap();
                if done {
                    break;
                }
            }
            socket.close(Some(CloseFrame { code: PREVIEW_ENDED_CLOSE_CODE.into(), reason: "Stopped".into() })).ok();
            while socket.read().is_ok() {}
        });

        let (events_tx, events_rx) = mpsc::channel::<String>();
        let ticket = PreviewTicket { url: format!("ws://127.0.0.1:{worker_port}/tunnel?token=t1"), expires_at: "2999-01-01T00:00:00Z".into() };
        let _tunnel = connect(local_port, ticket, Box::new(|| Err(TicketError::Failed)), move |event| {
            let text = match event {
                TunnelEvent::Status(status) => status.label().to_string(),
                TunnelEvent::Request { status } => format!("request {status:?}"),
            };
            events_tx.send(text).ok();
        });

        let mut frames = Vec::new();
        while let Ok(frame) = seen_rx.recv_timeout(Duration::from_secs(10)) {
            let end = frame.0 == "end";
            frames.push(frame);
            if end {
                break;
            }
        }
        assert_eq!(frames.first().map(|frame| frame.0.as_str()), Some("response 200"));
        let body: Vec<u8> = frames.iter().filter(|frame| frame.0 == "body").flat_map(|frame| frame.1.clone()).collect();
        assert_eq!(String::from_utf8(body).unwrap(), "hi there");
        assert_eq!(frames.last().map(|frame| frame.0.as_str()), Some("end"));

        let mut events = Vec::new();
        while let Ok(event) = events_rx.recv_timeout(Duration::from_secs(10)) {
            let stopped = event == "Stopped";
            events.push(event);
            if stopped {
                break;
            }
        }
        assert_eq!(events.first().map(String::as_str), Some("Connecting"));
        assert!(events.contains(&"Live".to_string()));
        assert!(events.contains(&"request Some(200)".to_string()));
        assert_eq!(events.last().map(String::as_str), Some("Stopped"), "close code 4003 ends the preview");
    }
}
