//! Connect-RPC's streaming envelopes, which is how a sandbox daemon streams a command's output
//! back: a flag byte, a four-byte big-endian length, then that many bytes of JSON. The last
//! envelope of a stream has [`FLAG_END`] set and carries the stream's trailers -- an error there
//! is the call failing after the status line already said 200.
//!
//! Framing only. Nothing here knows what the JSON means, so it is the one piece that stays the
//! same if a second provider also speaks Connect.

use crate::{Error, Result};

/// The envelope that ends a stream. Its payload is trailers, not another message.
pub const FLAG_END: u8 = 0b0000_0010;

const HEADER_BYTES: usize = 5;
/// A single envelope larger than this is treated as a broken stream rather than allocated.
const MAX_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub flags: u8,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn is_end(&self) -> bool {
        self.flags & FLAG_END != 0
    }

    pub fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_slice(&self.payload).ok()
    }
}

/// Wraps one message for sending. A request is a single envelope with no flags set.
pub fn encode(payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + payload.len());
    bytes.push(0);
    bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

/// Reads every envelope in `bytes`. A stream cut short is an error and not a short read: the
/// caller would otherwise take a command killed mid-output for one that finished.
pub fn decode(bytes: &[u8]) -> Result<Vec<Frame>> {
    let mut frames = Vec::new();
    let mut rest = bytes;
    while !rest.is_empty() {
        if rest.len() < HEADER_BYTES {
            return Err(Error::protocol("The sandbox's answer ended inside an envelope header."));
        }
        let flags = rest[0];
        let length = u32::from_be_bytes([rest[1], rest[2], rest[3], rest[4]]) as usize;
        if length > MAX_PAYLOAD_BYTES {
            return Err(Error::protocol(format!("The sandbox announced a {length} byte message, which is not a real one.")));
        }
        let end = HEADER_BYTES + length;
        if rest.len() < end {
            return Err(Error::protocol("The sandbox's answer ended in the middle of a message."));
        }
        frames.push(Frame { flags, payload: rest[HEADER_BYTES..end].to_vec() });
        rest = &rest[end..];
    }
    Ok(frames)
}

/// The error a trailing envelope carries, if it carries one. Connect puts a failure here when the
/// response already started, so this is the only place a 200 can still mean no.
pub fn stream_error(frame: &Frame) -> Option<String> {
    let error = frame.json()?.get("error")?.clone();
    let message = error.get("message").and_then(serde_json::Value::as_str).map(str::to_string);
    let code = error.get("code").and_then(serde_json::Value::as_str).map(str::to_string);
    message.or(code).or(Some("The sandbox stopped the command without saying why.".into()))
}
