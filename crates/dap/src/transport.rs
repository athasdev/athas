//! The Debug Adapter Protocol's wire format: a `Content-Length` header, a blank line, then that
//! many bytes of JSON. The same framing runs over an adapter's stdio and over TCP.

use std::io::{BufRead, Write};

use anyhow::{Context as _, Result, bail};
use serde_json::Value;

/// Adapters never send frames this large; a bigger length means the stream is corrupt.
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// Frames one message. The length counts bytes, not characters.
pub fn encode(message: &Value) -> Result<Vec<u8>> {
    let content = serde_json::to_vec(message)?;
    let mut frame = format!("Content-Length: {}\r\n\r\n", content.len()).into_bytes();
    frame.extend_from_slice(&content);
    Ok(frame)
}

pub fn write_message(writer: &mut impl Write, message: &Value) -> Result<()> {
    writer.write_all(&encode(message)?)?;
    writer.flush()?;
    Ok(())
}

/// Reads the next message, or `None` once the stream closes between messages. Headers other than
/// `Content-Length` (such as `Content-Type`) are skipped, and the header name is matched without
/// regard to case.
pub fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>> {
    let mut content_length = None;
    let mut line = String::new();
    let mut read_any = false;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            if read_any {
                bail!("debug adapter stream closed inside a message header");
            }
            return Ok(None);
        }
        read_any = true;
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            if content_length.is_some() {
                break;
            }
            // Stray blank lines between frames.
            continue;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("Content-Length")
        {
            content_length = Some(value.trim().parse::<usize>().context("invalid Content-Length")?);
        }
    }
    let length = content_length.context("debug adapter message is missing Content-Length")?;
    if length > MAX_FRAME_BYTES {
        bail!("debug adapter sent an oversized frame ({length} bytes)");
    }
    let mut content = vec![0; length];
    reader.read_exact(&mut content).context("debug adapter message was cut short")?;
    Ok(Some(serde_json::from_slice(&content).context("debug adapter sent invalid JSON")?))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use serde_json::json;

    use super::*;

    #[test]
    fn length_counts_bytes() {
        let message = json!({ "output": "Athas ğ ✓" });
        let frame = String::from_utf8(encode(&message).unwrap()).unwrap();
        let (header, body) = frame.split_once("\r\n\r\n").unwrap();
        assert_eq!(header, format!("Content-Length: {}", body.len()));
        assert!(body.len() > body.chars().count());
        assert_eq!(serde_json::from_str::<Value>(body).unwrap(), message);
    }

    #[test]
    fn reads_consecutive_frames_and_extra_headers() {
        let first = r#"{"seq":1}"#;
        let second = r#"{"seq":2,"text":"ğ"}"#;
        let input = format!(
            "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: {}\r\n\r\n{first}Content-Length:{}\r\n\r\n{second}",
            first.len(),
            second.len()
        );
        let mut reader = Cursor::new(input.into_bytes());
        assert_eq!(read_message(&mut reader).unwrap(), Some(json!({ "seq": 1 })));
        assert_eq!(read_message(&mut reader).unwrap(), Some(json!({ "seq": 2, "text": "ğ" })));
        assert_eq!(read_message(&mut reader).unwrap(), None);
    }

    #[test]
    fn round_trips_through_encode() {
        let mut bytes = Vec::new();
        write_message(&mut bytes, &json!({ "a": [1, 2] })).unwrap();
        write_message(&mut bytes, &json!({ "b": null })).unwrap();
        let mut reader = Cursor::new(bytes);
        assert_eq!(read_message(&mut reader).unwrap(), Some(json!({ "a": [1, 2] })));
        assert_eq!(read_message(&mut reader).unwrap(), Some(json!({ "b": null })));
    }

    #[test]
    fn rejects_bad_frames() {
        let missing = read_message(&mut Cursor::new(b"Content-Type: x\r\n\r\n{}".to_vec()));
        // The blank line alone does not end a header without a length; the stream then closes.
        assert!(missing.is_err());
        assert!(read_message(&mut Cursor::new(b"Content-Length: 10\r\n\r\n{}".to_vec())).is_err());
        assert!(read_message(&mut Cursor::new(b"Content-Length: nope\r\n\r\n".to_vec())).is_err());
        let huge = format!("Content-Length: {}\r\n\r\n", MAX_FRAME_BYTES + 1);
        assert!(read_message(&mut Cursor::new(huge.into_bytes())).is_err());
    }

    #[test]
    fn empty_stream_is_closed_not_an_error() {
        assert_eq!(read_message(&mut Cursor::new(Vec::new())).unwrap(), None);
    }
}
