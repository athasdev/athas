//! Server-sent events, the framing every provider streams in: `event:` and `data:` lines, a
//! blank line ending each event.

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// Collects lines into events.
#[derive(Default)]
pub struct SseDecoder {
    event: Option<String>,
    data: Vec<String>,
}

impl SseDecoder {
    /// Takes one line (without its newline); returns the event it completes, if any.
    pub fn line(&mut self, line: &str) -> Option<SseEvent> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            return self.finish();
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }

    /// The event still open when the stream ends.
    pub fn finish(&mut self) -> Option<SseEvent> {
        if self.data.is_empty() {
            self.event = None;
            return None;
        }
        Some(SseEvent { event: self.event.take(), data: std::mem::take(&mut self.data).join("\n") })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_events_split_over_lines() {
        let mut decoder = SseDecoder::default();
        let mut events = Vec::new();
        for line in ["event: message_start", "data: {\"a\":", "data: 1}", "", ": keep-alive", "data: [DONE]", ""] {
            events.extend(decoder.line(line));
        }
        assert_eq!(
            events,
            vec![
                SseEvent { event: Some("message_start".into()), data: "{\"a\":\n1}".into() },
                SseEvent { event: None, data: "[DONE]".into() },
            ]
        );
        decoder.line("data:tail");
        assert_eq!(decoder.finish(), Some(SseEvent { event: None, data: "tail".into() }));
    }
}
