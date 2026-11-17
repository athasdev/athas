//! `/compact` for Athas Agent, which keeps its history in Athas: the earlier turns become one
//! summary and the most recent turns stay word for word, so the next turn sends less.
//!
//! Ported from Athas's `services/chat-compaction-service.ts` and the extractive summary in
//! `lib/conversation-history.ts`.

use crate::thread::{Entry, UserMessage};

/// Recent history `/compact` keeps word for word.
const KEEP_RECENT_TOKENS: usize = 4_000;
const CHARS_PER_TOKEN: usize = 4;
const MAX_SUMMARY_CHARS: usize = 6_000;
const SUMMARY_START: &str = "[Summary of ";
const SUMMARY_END: &str = "[End of summary]";

fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(CHARS_PER_TOKEN)
}

fn clip(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    let kept: String = text.chars().take(max).collect();
    format!("{kept}… [{} more characters]", count - max)
}

fn message_text(entry: &Entry) -> Option<(bool, &str)> {
    match entry {
        Entry::User(message) => Some((true, &message.text)),
        Entry::Agent(message) => Some((false, &message.text)),
        _ => None,
    }
}

/// A short account of the conversation: each turn's first words, earlier summaries kept.
pub fn summarize(messages: &[(bool, &str)]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for (user, text) in messages {
        let mut content: &str = text;
        if content.starts_with(SUMMARY_START)
            && let Some(end) = content.find(SUMMARY_END)
        {
            let inner = content[..end].split_once('\n').map_or("", |(_, rest)| rest).trim();
            lines.push(format!("- Earlier summary: {}", clip(inner, MAX_SUMMARY_CHARS / 2)));
            content = &content[end + SUMMARY_END.len()..];
        }
        let text = content.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            continue;
        }
        let (label, max) = if *user { ("User", 300) } else { ("Assistant", 200) };
        lines.push(format!("- {label}: {}", clip(&text, max)));
    }
    let mut summary = lines.join("\n");
    while summary.chars().count() > MAX_SUMMARY_CHARS && lines.len() > 1 {
        lines.remove(lines.len() / 2);
        summary = format!("{}\n- [some turns omitted]", lines.join("\n"));
    }
    clip(&summary, MAX_SUMMARY_CHARS)
}

/// The index of the first entry to keep: a user turn, with about `keep_tokens` of recent text.
fn recent_start(entries: &[Entry], keep_tokens: usize) -> usize {
    let mut tokens = 0;
    let mut start = entries.len();
    for index in (0..entries.len()).rev() {
        tokens += message_text(&entries[index]).map_or(0, |(_, text)| estimate_tokens(text));
        if tokens > keep_tokens && start < entries.len() {
            break;
        }
        start = index;
    }
    while start < entries.len() && !matches!(entries[start], Entry::User(_)) {
        start += 1;
    }
    start
}

/// The entries `/compact` leaves: one summary of the earlier turns as a user message, then the
/// recent turns as they were. `None` when there is nothing earlier to summarise.
pub fn compact(entries: &[Entry]) -> Option<(Vec<Entry>, usize)> {
    let mut start = recent_start(entries, KEEP_RECENT_TOKENS);
    // Short chats keep only their last turn, so compacting always frees something up.
    if start == 0 || start >= entries.len() {
        start = entries.iter().rposition(|entry| matches!(entry, Entry::User(_))).filter(|index| *index > 0).unwrap_or(entries.len());
    }
    let older: Vec<(bool, &str)> = entries[..start].iter().filter_map(message_text).filter(|(_, text)| !text.trim().is_empty()).collect();
    if older.is_empty() {
        return None;
    }
    let summary = format!("{SUMMARY_START}{} earlier messages in this conversation]\n{}\n{SUMMARY_END}", older.len(), summarize(&older).trim());
    let mut kept = vec![Entry::User(UserMessage { text: summary, ..Default::default() })];
    kept.extend(entries[start..].iter().cloned());
    Some((kept, older.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{AgentMessage, Notice, NoticeKind};

    fn user(text: &str) -> Entry {
        Entry::User(UserMessage { text: text.into(), ..Default::default() })
    }

    fn agent(text: &str) -> Entry {
        Entry::Agent(AgentMessage { message_id: None, text: text.into(), ..Default::default() })
    }

    #[test]
    fn earlier_turns_become_one_summary() {
        let entries = vec![user("Add a test"), agent("Added it."), Entry::Notice(Notice { kind: NoticeKind::Info, text: "x".into() }), user("Now fix lint"), agent("Fixed.")];
        let (kept, count) = compact(&entries).unwrap();
        assert_eq!(count, 2);
        assert_eq!(kept.len(), 3);
        let Entry::User(summary) = &kept[0] else { panic!() };
        assert!(summary.text.starts_with("[Summary of 2 earlier messages in this conversation]\n- User: Add a test\n- Assistant: Added it."));
        assert!(matches!(&kept[1], Entry::User(message) if message.text == "Now fix lint"));
        assert!(compact(&[]).is_none());
    }

    #[test]
    fn a_second_compaction_keeps_the_earlier_summary() {
        let first = compact(&[user("one"), agent("a"), user("two"), agent("b")]).unwrap().0;
        let mut entries = first;
        entries.extend([user("three"), agent("c")]);
        let (kept, _) = compact(&entries).unwrap();
        let Entry::User(summary) = &kept[0] else { panic!() };
        assert!(summary.text.contains("- Earlier summary: - User: one"), "{}", summary.text);
    }
}
