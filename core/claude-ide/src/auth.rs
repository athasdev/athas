use std::io;
use tokio_tungstenite::tungstenite::http::{HeaderMap, HeaderValue, StatusCode, header};

/// The header Claude Code sends the lock file's token in when it opens the WebSocket.
pub const AUTH_HEADER: &str = "x-claude-code-ide-authorization";

const TOKEN_BYTES: usize = 16;

/// A fresh 128-bit token from the OS CSPRNG, as 32 lowercase hex characters.
pub fn generate_auth_token() -> io::Result<String> {
   let mut bytes = [0u8; TOKEN_BYTES];
   getrandom::getrandom(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
   Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Compares two tokens without returning early on the first differing byte, so response timing
/// does not reveal how much of a guess was right. The length is not secret: every token Athas
/// issues has the same length.
pub fn tokens_match(expected: &str, provided: &str) -> bool {
   let expected = expected.as_bytes();
   let provided = provided.as_bytes();
   if expected.is_empty() || expected.len() != provided.len() {
      return false;
   }
   let difference = expected
      .iter()
      .zip(provided)
      .fold(0u8, |acc, (left, right)| acc | (left ^ right));
   std::hint::black_box(difference) == 0
}

/// Decides whether a WebSocket upgrade may proceed. On success it returns the subprotocol to
/// echo back, since Claude Code's client refuses a handshake that drops the one it asked for.
pub fn authorize_upgrade(
   headers: &HeaderMap,
   expected_token: &str,
) -> Result<Option<HeaderValue>, StatusCode> {
   let mut provided = headers.get_all(AUTH_HEADER).iter();
   let token = match (provided.next(), provided.next()) {
      (Some(value), None) => value.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?,
      _ => return Err(StatusCode::UNAUTHORIZED),
   };
   if !tokens_match(expected_token, token) {
      return Err(StatusCode::UNAUTHORIZED);
   }

   let protocol = headers
      .get(header::SEC_WEBSOCKET_PROTOCOL)
      .and_then(|value| value.to_str().ok())
      .and_then(|value| {
         value
            .split(',')
            .map(str::trim)
            .find(|name| !name.is_empty())
      })
      .and_then(|name| HeaderValue::from_str(name).ok());
   Ok(protocol)
}

#[cfg(test)]
mod tests {
   use super::*;

   fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
      let mut map = HeaderMap::new();
      for (name, value) in pairs {
         map.append(
            header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_str(value).unwrap(),
         );
      }
      map
   }

   #[test]
   fn tokens_are_128_bit_lowercase_hex_and_unique() {
      let first = generate_auth_token().unwrap();
      let second = generate_auth_token().unwrap();
      assert_eq!(first.len(), 32);
      assert!(
         first
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
      );
      assert_ne!(first, second);
   }

   #[test]
   fn tokens_match_only_on_exact_equality() {
      assert!(tokens_match("abc123", "abc123"));
      assert!(!tokens_match("abc123", "abc124"));
      assert!(!tokens_match("abc123", "abc12"));
      assert!(!tokens_match("abc123", "abc1234"));
      assert!(!tokens_match("abc123", ""));
      assert!(!tokens_match("", ""));
   }

   #[test]
   fn upgrade_without_a_token_is_rejected() {
      assert_eq!(
         authorize_upgrade(&headers(&[]), "secret"),
         Err(StatusCode::UNAUTHORIZED)
      );
   }

   #[test]
   fn upgrade_with_a_wrong_token_is_rejected() {
      assert_eq!(
         authorize_upgrade(&headers(&[(AUTH_HEADER, "guess")]), "secret"),
         Err(StatusCode::UNAUTHORIZED)
      );
      assert_eq!(
         authorize_upgrade(&headers(&[(AUTH_HEADER, "")]), "secret"),
         Err(StatusCode::UNAUTHORIZED)
      );
   }

   #[test]
   fn upgrade_with_two_token_headers_is_rejected() {
      let map = headers(&[(AUTH_HEADER, "secret"), (AUTH_HEADER, "secret")]);
      assert_eq!(
         authorize_upgrade(&map, "secret"),
         Err(StatusCode::UNAUTHORIZED)
      );
   }

   #[test]
   fn upgrade_with_the_token_is_allowed_and_echoes_the_first_subprotocol() {
      assert_eq!(
         authorize_upgrade(&headers(&[(AUTH_HEADER, "secret")]), "secret"),
         Ok(None)
      );
      let map = headers(&[
         (AUTH_HEADER, "secret"),
         ("sec-websocket-protocol", "mcp, other"),
      ]);
      assert_eq!(
         authorize_upgrade(&map, "secret"),
         Ok(Some(HeaderValue::from_static("mcp")))
      );
   }
}
