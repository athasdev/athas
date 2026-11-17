//! A realtime room's socket (`connectCollaborationRoom`), kept open on a thread of its own: it
//! reconnects with backoff, renews its token shortly before the ticket expires, pings every
//! thirty seconds, holds queued messages until the socket opens, and gives up ("unavailable")
//! when rooms are off or the room never opened, so callers keep using REST.

use std::{
    collections::VecDeque,
    io::ErrorKind,
    net::TcpStream,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;
use tungstenite::{Message, WebSocket, protocol::CloseFrame, stream::MaybeTlsStream};

use crate::realtime::{self, ROOM_TOKEN_EXPIRED_CLOSE_CODE, RoomMessage, RoomStatus, RoomTicket};

const TICKET_REFRESH_MARGIN_MS: i64 = 60_000;
const KEEPALIVE: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_millis(200);
/// Failed connection attempts before a room that never opened gives way to polling.
const MAX_ATTEMPTS_BEFORE_FALLBACK: u32 = 3;
const MAX_QUEUED_MESSAGES: usize = 100;

/// Asks for a ticket: `Ok(None)` when rooms are off.
pub type TicketSource = Arc<dyn Fn() -> Result<Option<RoomTicket>, String> + Send + Sync>;

enum Command {
    Send(String),
    Close,
}

/// A room's connection; dropping it closes the room.
pub struct RoomConnection {
    commands: Sender<Command>,
    open: Arc<AtomicBool>,
    unavailable: Arc<AtomicBool>,
    queued: Arc<std::sync::Mutex<VecDeque<String>>>,
}

impl RoomConnection {
    pub fn is_open(&self) -> bool {
        self.open.load(Ordering::Relaxed)
    }

    /// Sends now when open; with `queue`, holds the message until the socket (re)opens.
    pub fn send(&self, message: &Value, queue: bool) -> bool {
        if self.unavailable.load(Ordering::Relaxed) {
            return false;
        }
        let text = message.to_string();
        if self.is_open() {
            return self.commands.send(Command::Send(text)).is_ok();
        }
        let mut queued = self.queued.lock().unwrap_or_else(|error| error.into_inner());
        if !queue || queued.len() >= MAX_QUEUED_MESSAGES {
            return false;
        }
        queued.push_back(text);
        true
    }

    pub fn close(&self) {
        self.commands.send(Command::Close).ok();
    }
}

impl Drop for RoomConnection {
    fn drop(&mut self) {
        self.close();
    }
}

/// Opens a room. `on_message` and `on_status` run on the room's thread.
pub fn connect(
    tickets: TicketSource,
    on_message: impl Fn(RoomMessage) + Send + 'static,
    on_status: impl Fn(RoomStatus) + Send + 'static,
) -> RoomConnection {
    let (commands, receiver) = mpsc::channel();
    let open = Arc::new(AtomicBool::new(false));
    let unavailable = Arc::new(AtomicBool::new(false));
    let queued = Arc::new(std::sync::Mutex::new(VecDeque::new()));
    let worker = Worker {
        tickets,
        receiver,
        open: open.clone(),
        unavailable: unavailable.clone(),
        queued: queued.clone(),
        on_message: Box::new(on_message),
        on_status: Box::new(on_status),
        status: RoomStatus::Connecting,
        ticket: None,
        attempts: 0,
        ever_opened: false,
        closed: false,
    };
    thread::Builder::new().name("athas-collaboration-room".into()).spawn(move || worker.run()).ok();
    RoomConnection { commands, open, unavailable, queued }
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

struct Worker {
    tickets: TicketSource,
    receiver: Receiver<Command>,
    open: Arc<AtomicBool>,
    unavailable: Arc<AtomicBool>,
    queued: Arc<std::sync::Mutex<VecDeque<String>>>,
    on_message: Box<dyn Fn(RoomMessage) + Send>,
    on_status: Box<dyn Fn(RoomStatus) + Send>,
    status: RoomStatus,
    ticket: Option<RoomTicket>,
    attempts: u32,
    ever_opened: bool,
    closed: bool,
}

fn set_read_timeout(socket: &mut Socket) {
    let stream = match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => stream.get_mut(),
        _ => return,
    };
    stream.set_read_timeout(Some(READ_TIMEOUT)).ok();
}

impl Worker {
    fn set_status(&mut self, status: RoomStatus) {
        if self.status != status {
            self.status = status;
            (self.on_status)(status);
        }
    }

    fn run(mut self) {
        (self.on_status)(self.status);
        while !self.closed {
            let Some(ticket) = self.current_ticket() else { break };
            match tungstenite::connect(ticket.url.as_str()) {
                Ok((mut socket, _)) => {
                    set_read_timeout(&mut socket);
                    self.serve(socket, ticket);
                }
                Err(_) => {}
            }
            if self.closed || !self.wait_to_reconnect() {
                break;
            }
        }
        self.open.store(false, Ordering::Relaxed);
        if self.closed {
            self.set_status(RoomStatus::Closed);
        }
    }

    /// A ticket that is still good, or a new one; `None` gives up.
    fn current_ticket(&mut self) -> Option<RoomTicket> {
        let now = realtime::now_ms();
        if let Some(ticket) = self.ticket.clone().filter(|ticket| ticket.expires_at - TICKET_REFRESH_MARGIN_MS / 2 > now) {
            return Some(ticket);
        }
        match (self.tickets)() {
            Ok(Some(ticket)) => {
                self.ticket = Some(ticket.clone());
                Some(ticket)
            }
            Ok(None) => {
                self.give_up();
                None
            }
            Err(_) => {
                if self.wait_to_reconnect() { self.current_ticket() } else { None }
            }
        }
    }

    fn give_up(&mut self) {
        self.unavailable.store(true, Ordering::Relaxed);
        self.queued.lock().unwrap_or_else(|error| error.into_inner()).clear();
        self.set_status(RoomStatus::Unavailable);
    }

    /// Backs off before the next attempt; `false` when the room gave up or was closed.
    fn wait_to_reconnect(&mut self) -> bool {
        self.attempts += 1;
        if !self.ever_opened && self.attempts >= MAX_ATTEMPTS_BEFORE_FALLBACK {
            self.give_up();
            return false;
        }
        self.set_status(RoomStatus::Reconnecting);
        let delay = realtime::reconnect_delay(self.attempts, rand_unit());
        let deadline = Instant::now() + delay;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return true;
            }
            match self.receiver.recv_timeout(left) {
                Ok(Command::Close) | Err(RecvTimeoutError::Disconnected) => {
                    self.closed = true;
                    return false;
                }
                Ok(Command::Send(_)) | Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    fn serve(&mut self, mut socket: Socket, ticket: RoomTicket) {
        self.attempts = 0;
        self.ever_opened = true;
        self.open.store(true, Ordering::Relaxed);
        self.set_status(RoomStatus::Open);
        let queued: Vec<String> = self.queued.lock().unwrap_or_else(|error| error.into_inner()).drain(..).collect();
        for message in queued {
            socket.send(Message::text(message)).ok();
        }
        let mut last_ping = Instant::now();
        let mut refresh_at = ticket.expires_at - TICKET_REFRESH_MARGIN_MS;
        loop {
            loop {
                match self.receiver.try_recv() {
                    Ok(Command::Send(text)) => {
                        socket.send(Message::text(text)).ok();
                    }
                    Ok(Command::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                        self.closed = true;
                        self.open.store(false, Ordering::Relaxed);
                        socket.close(Some(CloseFrame { code: 1000.into(), reason: "Closed".into() })).ok();
                        socket.flush().ok();
                        return;
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                }
            }
            if last_ping.elapsed() >= KEEPALIVE {
                last_ping = Instant::now();
                if socket.send(Message::text("ping")).is_err() {
                    break;
                }
            }
            if realtime::now_ms() >= refresh_at {
                refresh_at = i64::MAX;
                if let Ok(Some(next)) = (self.tickets)() {
                    refresh_at = next.expires_at - TICKET_REFRESH_MARGIN_MS;
                    if let Some(token) = next.token() {
                        socket.send(Message::text(serde_json::json!({ "type": "renew", "token": token }).to_string())).ok();
                    }
                    self.ticket = Some(next);
                }
            }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    if let Some(message) = realtime::parse_room_message(text.as_str()) {
                        (self.on_message)(message);
                    }
                }
                Ok(Message::Close(frame)) => {
                    if frame.is_some_and(|frame| u16::from(frame.code) == ROOM_TOKEN_EXPIRED_CLOSE_CODE) {
                        self.ticket = None;
                    }
                    break;
                }
                Ok(_) => {}
                Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(_) => break,
            }
        }
        self.open.store(false, Ordering::Relaxed);
    }
}

fn rand_unit() -> f64 {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.subsec_nanos());
    f64::from(nanos % 1000) / 1000.0
}

#[cfg(test)]
mod tests {
    use std::{
        net::TcpListener,
        sync::{Mutex, mpsc::channel},
    };

    use super::*;

    /// A local room: welcomes the client, echoes presence back as another member, and answers
    /// pings with "pong".
    fn mock_room() -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (seen, received) = channel();
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            socket
                .send(Message::text(r#"{"type":"welcome","self":{"connectionId":"me","userId":1,"deviceId":"d1"},"members":[{"connectionId":"them","userId":2,"deviceId":"d2"}]}"#))
                .unwrap();
            while let Ok(message) = socket.read() {
                let Message::Text(text) = message else { continue };
                seen.send(text.to_string()).ok();
                if text.as_str() == "ping" {
                    socket.send(Message::text("pong")).ok();
                } else if text.contains("presence") {
                    socket
                        .send(Message::text(r#"{"type":"presence","from":{"connectionId":"them","userId":2,"deviceId":"d2"},"data":{"updateType":"cursor","operation":{"path":"/a"}}}"#))
                        .ok();
                }
            }
        });
        (format!("ws://127.0.0.1:{port}/room?token=t1"), received)
    }

    #[test]
    fn a_room_opens_relays_presence_and_closes() {
        let (url, server_saw) = mock_room();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let statuses = Arc::new(Mutex::new(Vec::new()));
        let (recorded_messages, recorded_statuses) = (messages.clone(), statuses.clone());
        let tickets: TicketSource = Arc::new(move || Ok(Some(RoomTicket { url: url.clone(), expires_at: realtime::now_ms() + 10 * 60_000 })));
        let room = connect(tickets, move |message| recorded_messages.lock().unwrap().push(message), move |status| recorded_statuses.lock().unwrap().push(status));
        assert!(room.send(&serde_json::json!({ "type": "presence", "data": { "updateType": "cursor" } }), true));
        let deadline = Instant::now() + Duration::from_secs(5);
        while messages.lock().unwrap().len() < 2 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let got = messages.lock().unwrap().clone();
        assert!(matches!(got.first(), Some(RoomMessage::Welcome { members, .. }) if members.len() == 1));
        assert!(matches!(got.get(1), Some(RoomMessage::Presence { from, .. }) if from.device_id.as_deref() == Some("d2")));
        assert!(server_saw.recv_timeout(Duration::from_secs(2)).unwrap().contains("presence"));
        assert!(room.is_open());
        room.close();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !statuses.lock().unwrap().contains(&RoomStatus::Closed) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(statuses.lock().unwrap().first(), Some(&RoomStatus::Connecting));
        assert!(statuses.lock().unwrap().contains(&RoomStatus::Open));
        assert!(statuses.lock().unwrap().contains(&RoomStatus::Closed));
    }

    #[test]
    fn rooms_that_are_off_report_unavailable() {
        let statuses = Arc::new(Mutex::new(Vec::new()));
        let recorded = statuses.clone();
        let room = connect(Arc::new(|| Ok(None)), |_| {}, move |status| recorded.lock().unwrap().push(status));
        let deadline = Instant::now() + Duration::from_secs(2);
        while !statuses.lock().unwrap().contains(&RoomStatus::Unavailable) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(statuses.lock().unwrap().contains(&RoomStatus::Unavailable));
        assert!(!room.send(&serde_json::json!({}), true));
    }
}
