//! Redacts likely secrets from the lines the traffic inspector records: the MCP server `env` and
//! `headers` values sent in session setup, the values of secret-looking environment variables the
//! agent starts with, `Authorization` values and `Bearer`/`Basic` credentials, and tokens with a
//! well-known prefix. It errs towards leaving text alone: a candidate is redacted only when it is
//! long enough and has a digit, so prose such as "Bearer authentication" or "sk-learn" stays.
//!
//! Ported from Athas's `crates/ai/src/acp/traffic_secrets.rs` and the redaction in `traffic.rs`.

use serde_json::Value;

pub const REDACTED: &str = "[redacted]";

/// Environment variable name parts that mark its value as a secret.
const SECRET_ENV_NAME_PARTS: &[&str] = &["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "AUTH", "CREDENTIAL"];
/// Shorter values are too likely to occur by chance to be replaced wherever they appear.
const MIN_SECRET_ENV_VALUE_LEN: usize = 8;
/// Well-known token prefixes and how many token characters must follow them.
const TOKEN_PREFIXES: &[(&str, usize)] = &[
    ("sk-", 16),
    ("ghp_", 20),
    ("gho_", 20),
    ("ghu_", 20),
    ("ghs_", 20),
    ("ghr_", 20),
    ("github_pat_", 20),
    ("glpat-", 16),
    ("xoxb-", 10),
    ("xoxp-", 10),
    ("xoxa-", 10),
    ("xoxr-", 10),
    ("xoxs-", 10),
];
const AUTH_SCHEMES: &[&str] = &["bearer", "basic"];
const MIN_CREDENTIAL_LEN: usize = 8;

/// The values of `env` worth redacting: those of variables whose name looks like a secret.
pub fn secret_env_values<'a>(env: impl IntoIterator<Item = (&'a String, &'a String)>) -> Vec<String> {
    let mut values: Vec<String> = env
        .into_iter()
        .filter(|(name, value)| {
            let name = name.to_ascii_uppercase();
            value.len() >= MIN_SECRET_ENV_VALUE_LEN && SECRET_ENV_NAME_PARTS.iter().any(|part| name.contains(part))
        })
        .map(|(_, value)| value.clone())
        .collect();
    // Longest first, so a value that contains another is replaced whole.
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    values
}

/// Returns `text` with likely secrets replaced, or `None` when it has none.
pub fn scrub(text: &str, secrets: &[String]) -> Option<String> {
    let mut replaced: Option<String> = None;
    for secret in secrets {
        let current = replaced.as_deref().unwrap_or(text);
        if current.contains(secret.as_str()) {
            replaced = Some(current.replace(secret.as_str(), REDACTED));
        }
    }
    let current = replaced.as_deref().unwrap_or(text);
    match scrub_patterns(current) {
        Some(scrubbed) => Some(scrubbed),
        None => replaced,
    }
}

/// Returns `line` with the MCP server secrets sent in session setup (stdio `env` values and
/// HTTP/SSE `headers` values) replaced, or `None` when it carries none.
pub fn redact_line(line: &str) -> Option<String> {
    if !line.contains("\"mcpServers\"") {
        return None;
    }
    let mut value = serde_json::from_str::<Value>(line).ok()?;
    let changed = match &mut value {
        // Every entry is redacted, so this counts rather than stopping at the first change.
        Value::Array(items) => items.iter_mut().map(redact_message).filter(|&changed| changed).count() > 0,
        message => redact_message(message),
    };
    changed.then(|| value.to_string())
}

fn redact_message(message: &mut Value) -> bool {
    let Some(servers) = message.get_mut("params").and_then(|params| params.get_mut("mcpServers")).and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for server in servers {
        for field in ["env", "headers"] {
            let Some(pairs) = server.get_mut(field).and_then(Value::as_array_mut) else { continue };
            for pair in pairs {
                if let Some(value) = pair.get_mut("value") {
                    *value = Value::String(REDACTED.to_string());
                    changed = true;
                }
            }
        }
    }
    changed
}

fn scrub_patterns(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out: Option<String> = None;
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        let at_word_start = index == 0 || !is_word_byte(bytes[index - 1]);
        let found = if at_word_start && bytes[index].is_ascii_alphabetic() {
            prefixed_token(bytes, index).or_else(|| scheme_credential(bytes, index)).or_else(|| authorization_value(bytes, index))
        } else {
            None
        };
        match found {
            Some((start, end)) => {
                // Every match starts and ends next to ASCII bytes, so these are char boundaries.
                let out = out.get_or_insert_with(|| String::with_capacity(text.len()));
                out.push_str(&text[copied..start]);
                out.push_str(REDACTED);
                copied = end;
                index = end;
            }
            None => index += 1,
        }
    }
    let mut out = out?;
    out.push_str(&text[copied..]);
    Some(out)
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_key_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

/// Characters of a bearer token, API key or base64 credential.
fn is_credential_byte(byte: u8) -> bool {
    is_key_byte(byte) || matches!(byte, b'.' | b'~' | b'+' | b'/' | b'=')
}

fn run_end(bytes: &[u8], start: usize, accept: fn(u8) -> bool) -> usize {
    let mut end = start;
    while end < bytes.len() && accept(bytes[end]) {
        end += 1;
    }
    end
}

fn has_digit(bytes: &[u8]) -> bool {
    bytes.iter().any(u8::is_ascii_digit)
}

fn starts_with_ignore_case(bytes: &[u8], at: usize, word: &str) -> bool {
    bytes.get(at..at + word.len()).is_some_and(|slice| slice.eq_ignore_ascii_case(word.as_bytes()))
}

/// A token with a well-known prefix, such as `sk-…` or `ghp_…`, redacted whole.
fn prefixed_token(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    TOKEN_PREFIXES.iter().find_map(|(prefix, min_len)| {
        if !bytes[start..].starts_with(prefix.as_bytes()) {
            return None;
        }
        let body = start + prefix.len();
        let end = run_end(bytes, body, is_key_byte);
        let token = &bytes[body..end];
        (token.len() >= *min_len && has_digit(token) && token.iter().any(u8::is_ascii_alphabetic)).then_some((start, end))
    })
}

/// The credential after `Bearer ` or `Basic `, keeping the scheme.
fn scheme_credential(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    let scheme = AUTH_SCHEMES.iter().find(|scheme| starts_with_ignore_case(bytes, start, scheme))?;
    let after = start + scheme.len();
    let credential_start = run_end(bytes, after, |byte| byte == b' ');
    if credential_start == after {
        return None;
    }
    let end = run_end(bytes, credential_start, is_credential_byte);
    let credential = &bytes[credential_start..end];
    (credential.len() >= MIN_CREDENTIAL_LEN && has_digit(credential)).then_some((credential_start, end))
}

/// The value of an `Authorization` header or field, as in `Authorization: abc`,
/// `"authorization":"abc"` or `AUTHORIZATION=abc`. A value that starts with a scheme is left to
/// [`scheme_credential`], which keeps the scheme readable.
fn authorization_value(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    const KEY: &str = "authorization";
    if !starts_with_ignore_case(bytes, start, KEY) {
        return None;
    }
    let is_quote_or_space = |byte: u8| matches!(byte, b'"' | b'\'' | b'\\' | b' ');
    let separator = run_end(bytes, start + KEY.len(), is_quote_or_space);
    if !matches!(bytes.get(separator), Some(b':' | b'=')) {
        return None;
    }
    let value_start = run_end(bytes, separator + 1, is_quote_or_space);
    if AUTH_SCHEMES.iter().any(|scheme| starts_with_ignore_case(bytes, value_start, scheme)) {
        return None;
    }
    let end = run_end(bytes, value_start, is_credential_byte);
    let value = &bytes[value_start..end];
    (value.len() >= MIN_CREDENTIAL_LEN && has_digit(value)).then_some((value_start, end))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn redacts_env_secrets_tokens_and_credentials() {
        let env = [("API_KEY".to_string(), "env-secret-123".to_string()), ("HOME".to_string(), "/Users/someone".to_string())];
        let secrets = secret_env_values(env.iter().map(|(name, value)| (name, value)));
        assert_eq!(secrets, vec!["env-secret-123".to_string()]);
        assert_eq!(
            scrub("starting with key env-secret-123 and Bearer abc123def456ghi", &secrets).unwrap(),
            "starting with key [redacted] and Bearer [redacted]"
        );
        assert_eq!(scrub(r#"{"text":"ghp_0123456789abcdefghijABCDEFGHIJ"}"#, &[]).unwrap(), r#"{"text":"[redacted]"}"#);
        assert_eq!(scrub(r#""authorization":"tok3n-value-xyz""#, &[]).unwrap(), r#""authorization":"[redacted]""#);
    }

    #[test]
    fn leaves_prose_alone() {
        assert_eq!(scrub("Bearer authentication uses sk-learn", &[]), None);
    }

    #[test]
    fn redacts_every_mcp_server_of_a_batch() {
        let message = |id: u64| {
            json!({ "id": id, "method": "session/load", "params": { "mcpServers": [{ "env": [{ "name": "KEY", "value": "secret" }], "headers": [{ "name": "Authorization", "value": "x" }] }] } })
        };
        let line = json!([message(1), message(2)]).to_string();
        let redacted = redact_line(&line).unwrap();
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("\"KEY\""));
    }
}
