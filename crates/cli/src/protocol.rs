//! What goes over the channel: one JSON line from the client, one JSON line back.
//!
//! `{"version":1,"message":{"type":"open","requests":[…]}}` → `{"type":"ok"}`

use std::{
    io::{self, BufRead, BufReader, Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{CliRequest, transport};

pub const PROTOCOL_VERSION: u32 = 1;

/// A line longer than this is not an Athas client.
const MAX_LINE: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
    /// Opens what the requests name; no requests just brings Athas forward.
    Open { requests: Vec<CliRequest> },
    /// Asks whether the app is still there.
    Ping,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Reply {
    Ok,
    Error { message: String },
}

#[derive(Serialize, Deserialize)]
struct Envelope<T> {
    version: u32,
    message: T,
}

fn write_line(stream: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let mut line = serde_json::to_vec(value).map_err(io::Error::other)?;
    line.push(b'\n');
    stream.write_all(&line)?;
    stream.flush()
}

fn read_line<T: DeserializeOwned>(stream: impl Read) -> io::Result<T> {
    let mut line = String::new();
    BufReader::new(stream.take(MAX_LINE)).read_line(&mut line)?;
    if line.is_empty() {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the connection closed without a message"));
    }
    serde_json::from_str(&line).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// Sends `message` over an open stream and reads the reply.
pub fn exchange<S: Read + Write>(stream: &mut S, message: &Message) -> io::Result<Reply> {
    write_line(stream, &Envelope { version: PROTOCOL_VERSION, message })?;
    read_line(stream)
}

/// Connects to the app at `path` and sends `message`.
pub fn send(path: &Path, message: &Message) -> io::Result<Reply> {
    exchange(&mut transport::connect(path)?, message)
}

/// Whether an app answers at `path`.
pub fn ping(path: &Path) -> bool {
    matches!(send(path, &Message::Ping), Ok(Reply::Ok))
}

/// Reads one message from a client, lets `handle` answer it, and writes the answer back.
/// A message from another protocol version is refused without reaching `handle`.
pub fn serve<S: Read + Write>(stream: &mut S, handle: impl FnOnce(Message) -> Reply) -> io::Result<()> {
    let envelope: Envelope<serde_json::Value> = read_line(&mut *stream)?;
    let reply = if envelope.version != PROTOCOL_VERSION {
        Reply::Error {
            message: format!(
                "this athas command speaks protocol {}, the app speaks {PROTOCOL_VERSION}; reinstall the command",
                envelope.version
            ),
        }
    } else {
        match serde_json::from_value::<Message>(envelope.message) {
            Ok(Message::Ping) => Reply::Ok,
            Ok(message) => handle(message),
            Err(error) => Reply::Error { message: format!("could not read the request: {error}") },
        }
    };
    write_line(stream, &reply)
}

#[cfg(all(test, unix))]
mod tests {
    use std::{sync::mpsc, thread};

    use super::*;
    use crate::transport::{Bound, bind};

    fn listen(dir: &tempfile::TempDir) -> (std::path::PathBuf, transport::Listener) {
        let path = dir.path().join("athas.sock");
        let Bound::Listening(listener) = bind(&path).unwrap() else { panic!("nothing should listen yet") };
        (path, listener)
    }

    #[test]
    fn open_requests_reach_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let (path, listener) = listen(&dir);
        let (sender, received) = mpsc::channel();
        let server = thread::spawn(move || {
            for _ in 0..2 {
                let mut stream = listener.accept().unwrap();
                serve(&mut stream, |message| {
                    sender.send(message).unwrap();
                    Reply::Ok
                })
                .unwrap();
            }
        });

        assert!(ping(&path));
        let requests = vec![CliRequest::Web { url: "https://athas.dev".into() }];
        assert_eq!(send(&path, &Message::Open { requests: requests.clone() }).unwrap(), Reply::Ok);
        server.join().unwrap();
        assert_eq!(received.try_iter().collect::<Vec<_>>(), vec![Message::Open { requests }]);
    }

    #[test]
    fn a_second_app_finds_the_first() {
        let dir = tempfile::tempdir().unwrap();
        let (path, _listener) = listen(&dir);
        assert!(matches!(bind(&path).unwrap(), Bound::AlreadyRunning));
    }

    #[test]
    fn a_stale_socket_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let (path, listener) = listen(&dir);
        drop(listener);
        assert!(path.exists());
        assert!(!ping(&path));
        assert!(matches!(bind(&path).unwrap(), Bound::Listening(_)));
    }

    #[test]
    fn other_protocol_versions_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let (path, listener) = listen(&dir);
        let server = thread::spawn(move || {
            let mut stream = listener.accept().unwrap();
            serve(&mut stream, |_| panic!("an unknown version must not be handled")).unwrap();
        });
        let mut stream = transport::connect(&path).unwrap();
        write_line(&mut stream, &Envelope { version: 99, message: Message::Ping }).unwrap();
        let reply: Reply = read_line(&mut stream).unwrap();
        server.join().unwrap();
        assert!(matches!(reply, Reply::Error { .. }));
    }
}
