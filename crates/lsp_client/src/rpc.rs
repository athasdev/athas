//! JSON-RPC 2.0 over the LSP base protocol: `Content-Length` framed messages on a byte stream.

use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// A JSON-RPC error object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for RpcError {}

pub const METHOD_NOT_FOUND: i64 = -32601;

/// A message read from a server.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    /// The answer to one of our requests.
    Response { id: i64, result: Result<Value, RpcError> },
    /// A request the server makes of the client; it waits for a response with the same id.
    Request { id: Value, method: String, params: Value },
    Notification { method: String, params: Value },
}

#[derive(Deserialize)]
struct RawMessage {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

/// Keeps `"result": null` apart from a missing result.
fn present<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

pub fn parse(text: &str) -> anyhow::Result<Incoming> {
    let raw: RawMessage = serde_json::from_str(text)?;
    match (raw.method, raw.id) {
        (Some(method), Some(id)) => Ok(Incoming::Request { id, method, params: raw.params.unwrap_or(Value::Null) }),
        (Some(method), None) => Ok(Incoming::Notification { method, params: raw.params.unwrap_or(Value::Null) }),
        (None, Some(id)) => {
            let id = match &id {
                Value::Number(number) => number.as_i64(),
                Value::String(text) => text.parse().ok(),
                _ => None,
            }
            .ok_or_else(|| anyhow::anyhow!("response with an unknown id {id}"))?;
            let result = match raw.error {
                Some(error) => Err(error),
                None => Ok(raw.result.unwrap_or(Value::Null)),
            };
            Ok(Incoming::Response { id, result })
        }
        (None, None) => anyhow::bail!("message without a method or an id"),
    }
}

pub fn request(id: i64, method: &str, params: &Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string()
}

pub fn notification(method: &str, params: &Value) -> String {
    json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

pub fn response(id: &Value, result: Result<Value, RpcError>) -> String {
    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }).to_string(),
    }
}

/// Writes one framed message.
pub fn write_message(writer: &mut impl Write, body: &str) -> io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(body.as_bytes())?;
    writer.flush()
}

/// Reads one framed message; `None` at the end of the stream.
pub fn read_message(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut length: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            // Blank lines before any header (some servers print a stray newline) are skipped.
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("content-length")
        {
            length = Some(value.trim().parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidData, format!("bad header {header}")))?);
        }
    }
    let length = length.unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    String::from_utf8(body).map(Some).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let mut bytes = Vec::new();
        write_message(&mut bytes, r#"{"a":"é"}"#).unwrap();
        write_message(&mut bytes, "{}").unwrap();
        assert!(String::from_utf8_lossy(&bytes).starts_with("Content-Length: 10\r\n\r\n"));
        let mut reader = io::BufReader::new(&bytes[..]);
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some(r#"{"a":"é"}"#));
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some("{}"));
        assert_eq!(read_message(&mut reader).unwrap(), None);
    }

    #[test]
    fn extra_headers_and_case_are_accepted() {
        let raw = b"content-length: 2\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}";
        let mut reader = io::BufReader::new(&raw[..]);
        assert_eq!(read_message(&mut reader).unwrap().as_deref(), Some("{}"));
    }

    #[test]
    fn classifies_messages() {
        assert_eq!(parse(r#"{"jsonrpc":"2.0","id":3,"result":null}"#).unwrap(), Incoming::Response { id: 3, result: Ok(Value::Null) });
        assert_eq!(
            parse(r#"{"jsonrpc":"2.0","id":"4","error":{"code":-32601,"message":"no"}}"#).unwrap(),
            Incoming::Response { id: 4, result: Err(RpcError { code: METHOD_NOT_FOUND, message: "no".into(), data: None }) }
        );
        assert_eq!(
            parse(r#"{"jsonrpc":"2.0","id":7,"method":"workspace/configuration","params":{"items":[]}}"#).unwrap(),
            Incoming::Request { id: json!(7), method: "workspace/configuration".into(), params: json!({"items": []}) }
        );
        assert_eq!(
            parse(r#"{"jsonrpc":"2.0","method":"window/logMessage"}"#).unwrap(),
            Incoming::Notification { method: "window/logMessage".into(), params: Value::Null }
        );
        assert!(parse(r#"{"jsonrpc":"2.0"}"#).is_err());
    }

    #[test]
    fn builds_messages() {
        let request: Value = serde_json::from_str(&request(1, "initialize", &json!({"x": 1}))).unwrap();
        assert_eq!(request["method"], "initialize");
        assert_eq!(request["id"], 1);
        let error: Value = serde_json::from_str(&response(&json!("a"), Err(RpcError { code: -1, message: "m".into(), data: None }))).unwrap();
        assert_eq!(error["error"]["code"], -1);
        assert_eq!(error["id"], "a");
    }
}
