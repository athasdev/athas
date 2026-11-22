//! Data for a session's overview: the digest of its transcript, linked issues and file edits.

use serde::{Deserialize, Serialize};

use crate::{
    follow_ups, summary,
    thread::{Entry, PlanStatus, ToolContent, ToolStatus, Transcript},
};

/// What the Overview page shows, saved with the transcript.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionOverview {
    pub about: String,
    pub done: Vec<String>,
    pub remaining: Vec<String>,
    /// How many transcript entries it was written from: more since means it is out of date.
    pub entries: usize,
    /// What wrote it, such as "Claude Code · Haiku" or a model id.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source: String,
}

/// A GitHub issue the session is linked to.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkedIssue {
    pub number: u64,
    pub title: Option<String>,
    /// The issue's page when the session linked it by URL; such an issue may be another
    /// repository's.
    pub url: Option<String>,
}

/// The issues the session links: issue URLs in its messages, and issues added as context,
/// first mention first.
pub fn linked_issues(transcript: &Transcript) -> Vec<LinkedIssue> {
    let mut issues: Vec<LinkedIssue> = Vec::new();
    let note = |issues: &mut Vec<LinkedIssue>, number: u64, title: String, url: Option<String>| match issues.iter_mut().find(|issue| issue.number == number) {
        Some(issue) => {
            if !title.is_empty() {
                issue.title.get_or_insert(title);
            }
        }
        None => issues.push(LinkedIssue { number, title: (!title.is_empty()).then_some(title), url }),
    };
    for resource in summary::resources(transcript) {
        if let summary::Resource::Issue { number, url, .. } = resource {
            note(&mut issues, number, String::new(), Some(url));
        }
    }
    for entry in &transcript.entries {
        let Entry::User(message) = entry else { continue };
        for (number, title) in &message.issues {
            // A tab titled "#12 Crash on save" names the issue with its number in front.
            let title = title.trim_start_matches(&format!("#{number}")).trim().to_string();
            note(&mut issues, *number, title, None);
        }
        // An agent's replay of the prompt carries the context as text ("GitHub issue: Title (#12)").
        for line in message.text.lines() {
            let Some(rest) = line.trim().strip_prefix("GitHub issue: ") else { continue };
            let Some((title, number)) = rest.rsplit_once(" (#") else { continue };
            let Ok(number) = number.trim_end_matches(')').parse::<u64>() else { continue };
            note(&mut issues, number, title.to_string(), None);
        }
    }
    issues
}

/// One edit of a changed file: the entry and content index of its diff in the transcript.
#[derive(Clone, Debug, PartialEq)]
pub struct FileEdit {
    pub entry: usize,
    pub content: usize,
    pub old: Option<String>,
    pub new: String,
}

/// Each changed file's edits, oldest first, in the order the Changes summary lists the files
/// (latest change first).
pub fn file_edits(transcript: &Transcript) -> Vec<(summary::FileChange, Vec<FileEdit>)> {
    let changes = summary::changes(transcript);
    changes
        .files
        .into_iter()
        .map(|file| {
            let mut edits = Vec::new();
            for (entry, item) in transcript.entries.iter().enumerate() {
                let Entry::ToolCall(call) = item else { continue };
                for (content, part) in call.content.iter().enumerate() {
                    if let ToolContent::Diff { path, old_text, new_text } = part
                        && *path == file.path
                    {
                        edits.push(FileEdit { entry, content, old: old_text.clone(), new: new_text.clone() });
                    }
                }
            }
            (file, edits)
        })
        .collect()
}

/// The session as the overview model reads it: the first request, then the conversation, the
/// plan, the changed files and failed steps, cut to fit.
pub fn digest(transcript: &Transcript) -> String {
    fn clip(text: &str, max: usize) -> String {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() <= max { text } else { format!("{}…", text.chars().take(max).collect::<String>()) }
    }
    let first = transcript.first_prompt().map(|prompt| clip(follow_ups::strip_context_preamble(prompt), 1500)).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    for entry in &transcript.entries {
        match entry {
            Entry::User(message) => {
                let text = follow_ups::strip_context_preamble(&message.text);
                if !text.trim().is_empty() {
                    lines.push(format!("User: {}", clip(text, 600)));
                }
            }
            Entry::Agent(message) if !message.text.trim().is_empty() => lines.push(format!("Agent: {}", clip(&message.text, 500))),
            Entry::ToolCall(call) if call.status == ToolStatus::Failed => lines.push(format!("Failed step: {}", clip(&call.title, 160))),
            _ => {}
        }
    }
    let plan: Vec<String> = transcript
        .plan
        .iter()
        .map(|step| {
            let status = match step.status {
                PlanStatus::Completed => "done",
                PlanStatus::InProgress => "in progress",
                _ => "not started",
            };
            format!("- [{status}] {}", clip(&step.content, 200))
        })
        .collect();
    let changes = summary::changes(transcript);
    let files: Vec<String> = changes.files.iter().take(40).map(|file| format!("- {} (+{} −{})", file.path.display(), file.additions, file.deletions)).collect();

    let budget = ai_providers::inline_edit::CONTEXT_CHARS.saturating_sub(first.len() + plan.iter().chain(&files).map(|line| line.len() + 1).sum::<usize>() + 200);
    // The newest part of the conversation says most about where the session stands.
    let mut kept: Vec<&String> = Vec::new();
    let mut used = 0;
    for line in lines.iter().rev() {
        if used + line.len() + 1 > budget {
            break;
        }
        used += line.len() + 1;
        kept.push(line);
    }
    kept.reverse();
    let mut out = format!("First request:\n{first}\n\nConversation{}:\n", if kept.len() < lines.len() { " (latest part)" } else { "" });
    for line in kept {
        out.push_str(line);
        out.push('\n');
    }
    if !plan.is_empty() {
        out.push_str("\nPlan:\n");
        out.push_str(&plan.join("\n"));
        out.push('\n');
    }
    if !files.is_empty() {
        out.push_str("\nFiles changed:\n");
        out.push_str(&files.join("\n"));
        out.push('\n');
    }
    out
}

/// The overview the model writes from `text`, read leniently (fences, prose around the object).
pub fn parse(text: &str) -> Option<SessionOverview> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let value: serde_json::Value = serde_json::from_str(text.get(start..=end)?).ok()?;
    let list = |key: &str| -> Vec<String> {
        value
            .get(key)
            .and_then(|items| items.as_array())
            .map(|items| items.iter().filter_map(|item| item.as_str()).map(|item| item.trim().to_string()).filter(|item| !item.is_empty()).take(6).collect())
            .unwrap_or_default()
    };
    let about = value.get("about").and_then(|about| about.as_str()).unwrap_or_default().trim().to_string();
    (!about.is_empty()).then(|| SessionOverview { about, done: list("done"), remaining: list("remaining"), ..Default::default() })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityKind {
    Started,
    Asked,
    Edited,
    Ran,
    Failed,
}

/// One line of the Activity timeline: what happened after its actor's name, as plain and
/// emphasized parts, and when.
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityEvent {
    pub kind: ActivityKind,
    pub parts: Vec<(String, bool)>,
    pub at: Option<u64>,
}

/// The session's history, oldest first: each prompt, then what the agent did for it (the files
/// it changed, the commands it ran, the steps that failed).
pub fn activity(transcript: &Transcript) -> Vec<ActivityEvent> {
    fn clip(text: &str, max: usize) -> String {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() <= max { text } else { format!("{}…", text.chars().take(max).collect::<String>()) }
    }
    #[derive(Default)]
    struct Turn {
        files: Vec<String>,
        commands: usize,
        failed: Vec<(String, Option<u64>)>,
        at: Option<u64>,
    }
    fn flush(turn: &mut Turn, events: &mut Vec<ActivityEvent>) {
        let turn = std::mem::take(turn);
        if !turn.files.is_empty() {
            let mut parts = vec![("changed".to_string(), false)];
            let shown = turn.files.len().min(2);
            parts.push((turn.files[..shown].join(", "), true));
            if turn.files.len() > shown {
                parts.push((format!("and {} more", turn.files.len() - shown), false));
            }
            events.push(ActivityEvent { kind: ActivityKind::Edited, parts, at: turn.at });
        }
        if turn.commands > 0 {
            let label = format!("{} {}", turn.commands, if turn.commands == 1 { "command" } else { "commands" });
            events.push(ActivityEvent { kind: ActivityKind::Ran, parts: vec![("ran".into(), false), (label, true)], at: turn.at });
        }
        for (title, at) in turn.failed {
            events.push(ActivityEvent { kind: ActivityKind::Failed, parts: vec![("hit a failed step:".into(), false), (title, true)], at });
        }
    }

    let mut events = Vec::new();
    let mut turn = Turn::default();
    let mut prompts = 0;
    for entry in &transcript.entries {
        match entry {
            Entry::User(message) => {
                flush(&mut turn, &mut events);
                let text = clip(follow_ups::strip_context_preamble(&message.text), 90);
                if text.is_empty() {
                    continue;
                }
                let (kind, verb) = if prompts == 0 { (ActivityKind::Started, "started the session:") } else { (ActivityKind::Asked, "asked") };
                prompts += 1;
                events.push(ActivityEvent { kind, parts: vec![(verb.into(), false), (format!("“{text}”"), true)], at: message.sent_at });
            }
            Entry::ToolCall(call) => {
                turn.at = turn.at.or(call.started_at);
                if call.status == ToolStatus::Failed {
                    turn.failed.push((clip(&call.title, 70), call.started_at));
                    continue;
                }
                for part in &call.content {
                    if let ToolContent::Diff { path, .. } = part {
                        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
                        if !turn.files.contains(&name) {
                            turn.files.push(name);
                        }
                    }
                }
                if call.kind == crate::thread::ToolKind::Execute {
                    turn.commands += 1;
                }
            }
            _ => {}
        }
    }
    flush(&mut turn, &mut events);
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::UserMessage;

    #[test]
    fn reads_the_overview_through_fences_and_prose() {
        let text = "Here it is:\n```json\n{\"about\": \"Fixes the login.\", \"done\": [\"Found the bug\", \"\"], \"remaining\": [\"Tests\"]}\n```";
        let overview = parse(text).unwrap();
        assert_eq!(overview.about, "Fixes the login.");
        assert_eq!(overview.done, vec!["Found the bug"]);
        assert_eq!(overview.remaining, vec!["Tests"]);
        assert!(parse("{\"done\": []}").is_none());
    }

    #[test]
    fn links_issues_by_url_and_by_context() {
        let transcript = Transcript {
            entries: vec![
                Entry::User(UserMessage {
                    text: "Fix https://github.com/athasdev/athas/issues/12 please\nGitHub issue: Crash on save (#40)".into(),
                    issues: vec![(7, "#7 Slow start".into())],
                    ..Default::default()
                }),
                Entry::User(UserMessage { text: "GitHub issue: Same one (#12)".into(), ..Default::default() }),
            ],
            ..Default::default()
        };
        let issues = linked_issues(&transcript);
        assert_eq!(issues.iter().map(|issue| issue.number).collect::<Vec<_>>(), vec![12, 7, 40]);
        assert_eq!(issues[0].title.as_deref(), Some("Same one"));
        assert_eq!(issues[1].title.as_deref(), Some("Slow start"));
        assert_eq!(issues[2].title.as_deref(), Some("Crash on save"));
    }

    #[test]
    fn activity_groups_each_turn_after_its_prompt() {
        let transcript: Transcript = serde_json::from_value(serde_json::json!({ "entries": [
            { "type": "user", "text": "Fix the sync", "sentAt": 1 },
            { "type": "toolCall", "id": "a", "title": "Edit a.rs", "kind": "edit", "status": "completed",
              "content": [ { "type": "diff", "path": "/p/a.rs", "newText": "x" } ] },
            { "type": "toolCall", "id": "b", "title": "cargo test", "kind": "execute", "status": "completed" },
            { "type": "toolCall", "id": "c", "title": "cargo clippy", "kind": "execute", "status": "failed" },
            { "type": "user", "text": "Now the progress bar", "sentAt": 2 }
        ] }))
        .unwrap();
        let kinds: Vec<ActivityKind> = activity(&transcript).iter().map(|event| event.kind).collect();
        assert_eq!(kinds, [ActivityKind::Started, ActivityKind::Edited, ActivityKind::Ran, ActivityKind::Failed, ActivityKind::Asked]);
    }
}
