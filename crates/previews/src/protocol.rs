//! The frames a local preview's tunnel exchanges with the athas-cloud Worker
//! (`preview-protocol.ts`): a binary message of a big-endian u32 header length, the header as
//! UTF-8 JSON, then the body bytes. Plain text `ping` is answered with `pong`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type HeaderList = Vec<(String, String)>;

/// The Worker replaced this tunnel with a newer connection for the same preview.
pub const TUNNEL_REPLACED_CLOSE_CODE: u16 = 4000;
/// The tunnel's token expired; connect again with a new one.
pub const TUNNEL_TOKEN_EXPIRED_CLOSE_CODE: u16 = 4001;
/// The preview was stopped or expired.
pub const PREVIEW_ENDED_CLOSE_CODE: u16 = 4003;

const MAX_HEADER_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct TunnelRequest {
    pub id: String,
    pub method: String,
    pub path: String,
    pub headers: HeaderList,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ServerFrame {
    Welcome { preview: String, expires_at: String },
    Request(TunnelRequest),
    Cancel { id: String },
    Renewed { expires_at: String },
    Notice { message: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DesktopFrame {
    Response { id: String, status: u16, headers: HeaderList },
    Body { id: String },
    End { id: String },
    Error { id: String, message: String },
    Renew { token: String },
}

pub fn encode_frame(header: &DesktopFrame, payload: &[u8]) -> Vec<u8> {
    let json = serde_json::to_vec(header).unwrap_or_default();
    let mut frame = Vec::with_capacity(4 + json.len() + payload.len());
    frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
    frame.extend_from_slice(&json);
    frame.extend_from_slice(payload);
    frame
}

fn header_list(value: &Value) -> Option<HeaderList> {
    value
        .as_array()?
        .iter()
        .map(|entry| match entry.as_array().map(Vec::as_slice) {
            Some([name, value]) => Some((name.as_str()?.to_string(), value.as_str()?.to_string())),
            _ => None,
        })
        .collect()
}

/// A frame from the Worker with its payload, or `None` when it is malformed or unknown.
pub fn parse_server_frame(bytes: &[u8]) -> Option<(ServerFrame, &[u8])> {
    let length = u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    if length > MAX_HEADER_BYTES || 4 + length > bytes.len() {
        return None;
    }
    let header: Value = serde_json::from_slice(&bytes[4..4 + length]).ok()?;
    let payload = &bytes[4 + length..];
    let text = |key: &str| header.get(key).and_then(Value::as_str).map(str::to_string);
    let frame = match header.get("type")?.as_str()? {
        "welcome" => ServerFrame::Welcome { preview: text("preview")?, expires_at: text("expiresAt")? },
        "request" => ServerFrame::Request(TunnelRequest {
            id: text("id")?,
            method: text("method")?,
            path: text("path")?,
            headers: header_list(header.get("headers")?)?,
        }),
        "cancel" => ServerFrame::Cancel { id: text("id")? },
        "renewed" => ServerFrame::Renewed { expires_at: text("expiresAt")? },
        "notice" => ServerFrame::Notice { message: text("message")? },
        _ => return None,
    };
    Some((frame, payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_frame(header: Value, payload: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(&header).unwrap();
        let mut bytes = (json.len() as u32).to_be_bytes().to_vec();
        bytes.extend(json);
        bytes.extend_from_slice(payload);
        bytes
    }

    #[test]
    fn encodes_desktop_frames_as_the_worker_reads_them() {
        let frame = encode_frame(&DesktopFrame::Response { id: "r1".into(), status: 200, headers: vec![("content-type".into(), "text/html".into())] }, b"");
        let length = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&frame[4..4 + length]).unwrap();
        assert_eq!(header, serde_json::json!({ "type": "response", "id": "r1", "status": 200, "headers": [["content-type", "text/html"]] }));
        let body = encode_frame(&DesktopFrame::Body { id: "r1".into() }, b"hello");
        assert!(body.ends_with(b"hello"));
    }

    #[test]
    fn parses_server_frames_and_rejects_bad_ones() {
        let bytes = server_frame(serde_json::json!({ "type": "request", "id": "1", "method": "POST", "path": "/a", "headers": [["x", "y"]] }), b"body");
        let (frame, payload) = parse_server_frame(&bytes).unwrap();
        assert_eq!(frame, ServerFrame::Request(TunnelRequest { id: "1".into(), method: "POST".into(), path: "/a".into(), headers: vec![("x".into(), "y".into())] }));
        assert_eq!(payload, b"body");
        assert!(parse_server_frame(&server_frame(serde_json::json!({ "type": "request", "id": "1" }), b"")).is_none());
        assert!(parse_server_frame(&server_frame(serde_json::json!({ "type": "other" }), b"")).is_none());
        assert!(parse_server_frame(&[0, 0, 0, 9, b'{']).is_none());
        let (welcome, _) = parse_server_frame(&server_frame(serde_json::json!({ "type": "welcome", "preview": "p", "expiresAt": "t" }), b"")).unwrap();
        assert_eq!(welcome, ServerFrame::Welcome { preview: "p".into(), expires_at: "t".into() });
    }
}
