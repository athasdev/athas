//! JSON with comments and trailing commas, as VS Code and Zed write their settings.

use anyhow::Result;
use serde_json::Value;

/// Parses JSONC: `//` and `/* */` comments and trailing commas are allowed.
pub fn parse_jsonc(text: &str) -> Result<Value> {
    Ok(serde_json::from_str(&strip_jsonc(text))?)
}

/// The same text as plain JSON: comments become spaces and trailing commas go, so error offsets
/// still point at the right line.
fn strip_jsonc(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    // Where the last comma written outside a string sits in `out`, until something else follows.
    let mut pending_comma: Option<usize> = None;
    while index < chars.len() {
        let c = chars[index];
        match c {
            '"' => {
                pending_comma = None;
                out.push(c);
                index += 1;
                while index < chars.len() {
                    let c = chars[index];
                    out.push(c);
                    index += 1;
                    if c == '\\' {
                        if let Some(&escaped) = chars.get(index) {
                            out.push(escaped);
                            index += 1;
                        }
                    } else if c == '"' {
                        break;
                    }
                }
            }
            '/' if chars.get(index + 1) == Some(&'/') => {
                while index < chars.len() && chars[index] != '\n' {
                    out.push(' ');
                    index += 1;
                }
            }
            '/' if chars.get(index + 1) == Some(&'*') => {
                index += 2;
                out.push_str("  ");
                while index < chars.len() && !(chars[index] == '*' && chars.get(index + 1) == Some(&'/')) {
                    out.push(if chars[index] == '\n' { '\n' } else { ' ' });
                    index += 1;
                }
                index = (index + 2).min(chars.len());
                out.push_str("  ");
            }
            ',' => {
                pending_comma = Some(out.len());
                out.push(c);
                index += 1;
            }
            '}' | ']' => {
                if let Some(at) = pending_comma.take() {
                    out.replace_range(at..at + 1, " ");
                }
                out.push(c);
                index += 1;
            }
            c if c.is_whitespace() => {
                out.push(c);
                index += 1;
            }
            _ => {
                pending_comma = None;
                out.push(c);
                index += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn comments_and_trailing_commas() {
        let text = "\u{feff}{\n  // a comment\n  \"a\": \"http://x // not a comment\", /* block\n */ \"b\": [1, 2,],\n}\n";
        assert_eq!(parse_jsonc(text).unwrap(), json!({ "a": "http://x // not a comment", "b": [1, 2] }));
        assert_eq!(parse_jsonc(r#"{"a": "quote \" , }"}"#).unwrap(), json!({ "a": "quote \" , }" }));
        assert!(parse_jsonc("{ \"a\": }").is_err());
    }
}
