//! Saved sessions: listing, searching their transcripts, and a summary of one to hand another
//! session as context (an `@` mention).
//!
//! Ported from Athas's `services/ai-chat-history-service.ts` and `crates/ai/src/chat_history.rs`
//! (search over saved chats).

use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

use crate::{
    persistence,
    thread::{Entry, Transcript},
    title,
};

#[derive(Clone, Debug, PartialEq)]
pub struct SavedSession {
    pub id: String,
    pub title: String,
    pub modified: SystemTime,
    /// Messages, tool calls and notices in the transcript.
    pub entries: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SearchHit {
    pub session: SavedSession,
    /// The first matching line, shortened around the match.
    pub snippet: String,
    pub matches: usize,
}

/// A transcript's title: the agent's, else its first prompt's.
pub fn transcript_title(transcript: &Transcript) -> String {
    transcript
        .agent_title
        .as_deref()
        .and_then(title::clean_chat_title)
        .or_else(|| transcript.first_prompt().and_then(title::title_from_prompt))
        .unwrap_or_else(|| "Untitled session".to_string())
}

fn read(path: &Path) -> Option<(String, Transcript, SystemTime)> {
    let id = path.file_stem()?.to_str()?.to_string();
    let modified = path.metadata().and_then(|metadata| metadata.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    let transcript: Transcript = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    Some((id, transcript, modified))
}

fn transcripts(dir: &Path) -> Vec<(String, Transcript, SystemTime)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let paths: Vec<PathBuf> =
        entries.flatten().map(|entry| entry.path()).filter(|path| path.extension().is_some_and(|extension| extension == "json")).collect();
    let mut found: Vec<_> = paths.iter().filter_map(|path| read(path)).filter(|(_, transcript, _)| !transcript.entries.is_empty()).collect();
    found.sort_by(|a, b| b.2.cmp(&a.2));
    found
}

fn saved(id: String, transcript: &Transcript, modified: SystemTime) -> SavedSession {
    SavedSession { title: transcript_title(transcript), id, modified, entries: transcript.entries.len() }
}

/// Every saved session, newest first.
pub fn list(dir: &Path) -> Vec<SavedSession> {
    transcripts(dir).into_iter().map(|(id, transcript, modified)| saved(id, &transcript, modified)).collect()
}

/// The searchable text of an entry.
fn entry_text(entry: &Entry) -> Option<&str> {
    match entry {
        Entry::User(message) => Some(&message.text),
        Entry::Agent(message) => Some(&message.text),
        Entry::Thought(thought) => Some(&thought.text),
        Entry::ToolCall(call) => Some(&call.title),
        Entry::Notice(_) => None,
    }
}

/// Sessions whose title or transcript contains every word of `query`, case-insensitively; the
/// best matches (title hits, then most matches) first, newest first among equals.
pub fn search(dir: &Path, query: &str) -> Vec<SearchHit> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut hits: Vec<(bool, SearchHit)> = transcripts(dir)
        .into_iter()
        .filter_map(|(id, transcript, modified)| {
            let session = saved(id, &transcript, modified);
            if words.is_empty() {
                return Some((false, SearchHit { session, snippet: String::new(), matches: 0 }));
            }
            let title = session.title.to_lowercase();
            let lines: Vec<&str> = transcript.entries.iter().filter_map(entry_text).flat_map(str::lines).collect();
            let lowered: Vec<String> = lines.iter().map(|line| line.to_lowercase()).collect();
            let all_found = words.iter().all(|word| title.contains(word) || lowered.iter().any(|line| line.contains(word)));
            if !all_found {
                return None;
            }
            let matches = lowered.iter().map(|line| words.iter().map(|word| line.matches(word.as_str()).count()).sum::<usize>()).sum();
            let snippet = lowered
                .iter()
                .position(|line| words.iter().any(|word| line.contains(word)))
                .map(|index| snippet(lines[index], &lowered[index], &words))
                .unwrap_or_default();
            let in_title = words.iter().all(|word| title.contains(word));
            Some((in_title, SearchHit { session, snippet, matches }))
        })
        .collect();
    hits.sort_by(|(a_title, a), (b_title, b)| {
        b_title.cmp(a_title).then(b.matches.cmp(&a.matches)).then(b.session.modified.cmp(&a.session.modified))
    });
    hits.into_iter().map(|(_, hit)| hit).collect()
}

/// About 120 characters of `line` around the first word found.
fn snippet(line: &str, lowered: &str, words: &[String]) -> String {
    let at = words.iter().filter_map(|word| lowered.find(word.as_str())).min().unwrap_or(0);
    // Lowercasing can change byte lengths; fall back to the start when the offset does not fit.
    let at = if line.is_char_boundary(at) { at } else { 0 };
    let start = line[..at].char_indices().rev().nth(40).map_or(0, |(index, _)| index);
    let text: String = line[start..].chars().take(120).collect();
    let text = text.trim();
    if start > 0 { format!("…{text}") } else { text.to_string() }
}

/// A saved session as context for another: what was asked and answered, and the files it
/// changed, cut to `limit` characters.
pub fn summary(transcript: &Transcript, limit: usize) -> String {
    let mut out = format!("# {}\n", transcript_title(transcript));
    for entry in &transcript.entries {
        let line = match entry {
            Entry::User(message) => format!("\n**User:** {}\n", message.text.trim()),
            Entry::Agent(message) => format!("\n**Agent:** {}\n", message.text.trim()),
            Entry::ToolCall(call) if call.diffs().next().is_some() => {
                let files: Vec<String> = call.diffs().map(|(path, _, _)| path.display().to_string()).collect();
                format!("\n- Changed {}\n", files.join(", "))
            }
            _ => continue,
        };
        if out.len() + line.len() > limit {
            out.push_str("\n… (earlier session cut to fit)\n");
            break;
        }
        out.push_str(&line);
    }
    out
}

/// The saved transcript of session `id`.
pub fn load(id: &str) -> Option<Transcript> {
    persistence::load(&persistence::sessions_dir()?, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{AgentMessage, ToolCall, ToolContent};

    fn save(dir: &Path, id: &str, prompt: &str, answer: &str) {
        let mut transcript = Transcript::default();
        transcript.push_user(prompt.into(), Vec::new());
        transcript.entries.push(Entry::Agent(AgentMessage { message_id: None, text: answer.into(), ..Default::default() }));
        persistence::save(dir, id, &transcript).unwrap();
    }

    #[test]
    fn searches_titles_and_transcripts() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), "a", "Fix the login bug", "The token refresh was racing.");
        save(dir.path(), "b", "Add dark mode", "Done; the login page follows the theme too.");
        save(dir.path(), "c", "Unrelated", "Nothing here");
        persistence::save(dir.path(), "empty", &Transcript::default()).unwrap();

        assert_eq!(list(dir.path()).len(), 3);
        let hits = search(dir.path(), "login");
        assert_eq!(hits.iter().map(|hit| hit.session.id.as_str()).collect::<Vec<_>>(), ["a", "b"], "title matches first");
        assert_eq!(hits[1].snippet, "Done; the login page follows the theme too.");
        assert_eq!(search(dir.path(), "LOGIN token").len(), 1);
        assert!(search(dir.path(), "nowhere").is_empty());
        assert_eq!(search(dir.path(), "  ").len(), 3);
    }

    #[test]
    fn summaries_name_changed_files_and_fit_the_limit() {
        let mut transcript = Transcript::default();
        transcript.push_user("Rename it".into(), Vec::new());
        transcript.entries.push(Entry::ToolCall(ToolCall {
            content: vec![ToolContent::Diff { path: "/p/a.rs".into(), old_text: None, new_text: "x".into() }],
            ..Default::default()
        }));
        transcript.entries.push(Entry::Agent(AgentMessage { message_id: None, text: "Renamed.".into(), ..Default::default() }));
        let summary = summary(&transcript, 10_000);
        assert!(summary.starts_with("# Rename it"));
        assert!(summary.contains("- Changed /p/a.rs") && summary.contains("**Agent:** Renamed."));
        assert!(super::summary(&transcript, 30).contains("cut to fit"));
    }

    #[test]
    fn snippets_center_on_the_match() {
        let line = format!("{} needle and more", "word ".repeat(30));
        let lowered = line.to_lowercase();
        let snippet = snippet(&line, &lowered, &["needle".to_string()]);
        assert!(snippet.starts_with('…') && snippet.contains("needle"));
    }
}
