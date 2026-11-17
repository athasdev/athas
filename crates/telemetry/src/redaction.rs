//! What a crash report must not carry (`telemetry/lib/crash-report-redaction.ts`), and the noise
//! that is not a crash at all (`crash-noise.ts`).

use std::sync::LazyLock;

use regex::Regex;

const MAX_CRASH_TEXT_CHARS: usize = 2000;

static QUOTED_TEXT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`"#).expect("quoted text pattern"));

/// Any absolute path (two or more parts on Unix, any drive on Windows) and `~/…`: projects live
/// in `/opt`, `/srv`, `/workspace`, `D:\clients\…` as much as in home folders. The app's own
/// frames are relative (`crates/…`) and stay.
static USER_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        // The path must start the text or follow a character that cannot be part of a path,
        // so `crates/x/src/a.rs` (relative) is not taken for `/x/src/a.rs`.
        r#"(^|[^A-Za-z0-9._~@/\\-])(?:file://)?(?:/[A-Za-z0-9._@-]+/[^\s:)'"`]*|[A-Za-z]:[\\/][^\s:)'"`]*|~[\\/][^\s:)'"`]*)"#,
    )
    .expect("user path pattern")
});

/// A web address's query and fragment, where tokens and keys travel (`?token=…`).
static URL_QUERY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(https?://[^\s?#)'"`]+)[?#][^\s)'"`]*"#).expect("url query pattern"));

/// Strips quoted text, where error messages echo prompts, model output or file contents, and
/// paths inside the user's home or temporary folders. What is left is the error's shape and the
/// app's own frames.
pub fn redact_crash_text(value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }
    let unquoted = QUOTED_TEXT.replace_all(value, "<redacted>");
    let no_queries = URL_QUERY.replace_all(&unquoted, "$1?<redacted>");
    let redacted = USER_PATH.replace_all(&no_queries, "${1}<path>");
    Some(redacted.chars().take(MAX_CRASH_TEXT_CHARS).collect())
}

/// Whether an error is a cancellation that callers expect, not a crash.
pub fn is_expected_cancellation(message: &str) -> bool {
    matches!(message, "Canceled" | "Canceled: Canceled" | "CancellationError")
}

/// `dev` for debug builds, `release` otherwise.
pub fn crash_report_build() -> &'static str {
    if cfg!(debug_assertions) { "dev" } else { "release" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_quoted_text_and_home_paths() {
        let text = r#"Failed to open "secret prompt" at /Users/alex/code/app/src/main.rs:12"#;
        assert_eq!(redact_crash_text(text).unwrap(), "Failed to open <redacted> at <path>:12");
        assert_eq!(redact_crash_text(r"C:\Users\alex\file.txt broke").unwrap(), "<path> broke");
        assert_eq!(redact_crash_text("~/notes.md and 'quoted'").unwrap(), "<path> and <redacted>");
        assert_eq!(redact_crash_text("file:///tmp/x.txt").unwrap(), "<path>");
        assert_eq!(redact_crash_text("open /opt/acme/app.rs failed").unwrap(), "open <path> failed");
        assert_eq!(redact_crash_text(r"D:\clients\acme\a.rs broke").unwrap(), "<path> broke");
        assert!(!redact_crash_text("GET https://api.x.dev/v1?token=abc failed").unwrap().contains("abc"));
    }

    #[test]
    fn keeps_app_frames_and_caps_length() {
        assert_eq!(redact_crash_text("at workbench::render (crates/workbench/src/lib.rs:4)").unwrap(), "at workbench::render (crates/workbench/src/lib.rs:4)");
        assert_eq!(redact_crash_text(&"x".repeat(5000)).unwrap().len(), MAX_CRASH_TEXT_CHARS);
        assert_eq!(redact_crash_text(""), None);
    }

    #[test]
    fn cancellations_are_not_crashes() {
        assert!(is_expected_cancellation("Canceled"));
        assert!(!is_expected_cancellation("index out of bounds"));
    }
}
