//! What a session's dock shows about it: where it runs, how full the context is, the files it
//! changed, what it runs now, its plan and its cost. Plain data, derived from the transcript.
//!
//! Ported from Athas's `session-panel/services/{session-boxes,session-environment,
//! session-context-usage,session-plan,session-command-output}.ts`.

use std::path::{Path, PathBuf};

use crate::{
    diff,
    thread::{Cost, Entry, PlanEntry, PlanStatus, ToolKind, ToolStatus, Transcript},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionSummary {
    /// The agent's name, such as "Athas Agent" or "Claude Agent".
    pub agent: String,
    /// The model the session runs, when the agent names it.
    pub model: Option<String>,
    pub mode: Option<String>,
    pub environment: Option<Environment>,
    pub context: Option<ContextUsage>,
    pub changes: Changes,
    pub running: Vec<RunningCommand>,
    /// Dev servers the session's commands started that answer.
    pub servers: Vec<String>,
    pub plan: Option<Plan>,
    pub cost: Option<SessionCost>,
    pub turn_running: bool,
    /// What the agent does now: its latest step.
    pub focus: Option<Focus>,
    /// Files the agent read or searched but did not change, newest first.
    pub files: Vec<PathBuf>,
    /// Commands the agent ran, newest first.
    pub commands: Vec<CommandRun>,
    /// Pull requests, issues and links the conversation referenced.
    pub resources: Vec<Resource>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Focus {
    pub kind: ToolKind,
    pub label: String,
    pub path: Option<PathBuf>,
    pub running: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CommandRun {
    pub tool_call_id: String,
    pub command: String,
    pub status: ToolStatus,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Resource {
    PullRequest { number: u64, label: String, url: String },
    Issue { number: u64, label: String, url: String },
    Link { label: String, url: String },
}

impl Resource {
    pub fn url(&self) -> &str {
        match self {
            Resource::PullRequest { url, .. } | Resource::Issue { url, .. } | Resource::Link { url, .. } => url,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Environment {
    pub workspace: PathBuf,
    pub name: String,
    pub branch: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContextUsage {
    pub used: u64,
    /// 0 when the agent does not say how big its window is.
    pub size: u64,
}

impl ContextUsage {
    pub fn percent(&self) -> Option<f32> {
        (self.size > 0).then(|| (self.used as f32 / self.size as f32 * 100.).clamp(0., 100.))
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Changes {
    pub files: Vec<FileChange>,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FileChange {
    pub path: PathBuf,
    pub additions: usize,
    pub deletions: usize,
    /// The agent created the file.
    pub created: bool,
    /// How many edits the session made to the file.
    pub edits: usize,
    /// The status of the latest edit: a failed or cancelled one stays in the list, as in Athas.
    pub status: ToolStatus,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunningCommand {
    pub tool_call_id: String,
    pub command: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub entries: Vec<PlanEntry>,
    pub done: usize,
}

impl Plan {
    /// The step in progress, else the first one still to do.
    pub fn current(&self) -> Option<&PlanEntry> {
        self.entries
            .iter()
            .find(|entry| entry.status == PlanStatus::InProgress)
            .or_else(|| self.entries.iter().find(|entry| entry.status == PlanStatus::Pending))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionCost {
    pub cost: Option<Cost>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Every file the session edited, from the first state it saw to the last it wrote, newest
/// change first. As in Athas's `buildAgentSessionContext`, every edit counts: one that failed
/// or was cancelled, and a file whose edits net to nothing, keep their row with the latest
/// edit's status and the number of edits.
pub fn changes(transcript: &Transcript) -> Changes {
    struct Edited {
        path: PathBuf,
        old: Option<String>,
        new: String,
        edits: usize,
        status: ToolStatus,
    }
    let mut files: Vec<Edited> = Vec::new();
    for entry in &transcript.entries {
        let Entry::ToolCall(call) = entry else { continue };
        for (path, old, new) in call.diffs() {
            match files.iter().position(|existing| existing.path == *path) {
                Some(index) => {
                    let mut change = files.remove(index);
                    change.new = new.to_string();
                    change.edits += 1;
                    change.status = call.status;
                    files.insert(0, change);
                }
                None => files.insert(0, Edited { path: path.clone(), old: old.map(str::to_string), new: new.to_string(), edits: 1, status: call.status }),
            }
        }
    }
    let mut changes = Changes::default();
    for Edited { path, old, new, edits, status } in files {
        let (additions, deletions) = diff::stats(&diff::diff_rows(old.as_deref().unwrap_or(""), &new));
        changes.additions += additions;
        changes.deletions += deletions;
        changes.files.push(FileChange { path, additions, deletions, created: old.is_none(), edits, status });
    }
    changes
}

/// Commands the agent runs right now.
pub fn running(transcript: &Transcript) -> Vec<RunningCommand> {
    transcript
        .entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::ToolCall(call) if call.kind == ToolKind::Execute && call.status.is_running() => {
                Some(RunningCommand { tool_call_id: call.id.clone(), command: call.command().unwrap_or_else(|| call.title.clone()) })
            }
            _ => None,
        })
        .collect()
}

pub fn summarize(transcript: &Transcript, workspace: Option<&Path>, agent: String, turn_running: bool) -> SessionSummary {
    let option = |category: &str| {
        transcript
            .config_options
            .iter()
            .find(|option| option.category.as_deref() == Some(category))
            .map(|option| option.current_name().to_string())
    };
    let mode = option("mode").or_else(|| {
        let modes = transcript.modes.as_ref()?;
        modes.available.iter().find(|mode| mode.id == modes.current).map(|mode| mode.name.clone())
    });
    let usage = transcript.usage.as_ref();
    let cost = usage
        .filter(|usage| usage.cost.is_some() || usage.input_tokens.is_some() || usage.output_tokens.is_some())
        .map(|usage| SessionCost { cost: usage.cost.clone(), input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
    SessionSummary {
        agent,
        model: option("model"),
        mode,
        environment: workspace.map(|workspace| Environment {
            workspace: workspace.to_path_buf(),
            name: workspace.file_name().map_or_else(|| workspace.display().to_string(), |name| name.to_string_lossy().into_owned()),
            branch: git_branch(workspace),
        }),
        context: usage.filter(|usage| usage.used > 0 || usage.size > 0).map(|usage| ContextUsage { used: usage.used, size: usage.size }),
        changes: changes(transcript),
        running: running(transcript),
        servers: Vec::new(),
        plan: (!transcript.plan.is_empty()).then(|| Plan {
            done: transcript.plan.iter().filter(|entry| entry.status == PlanStatus::Completed).count(),
            entries: transcript.plan.clone(),
        }),
        cost,
        turn_running,
        focus: focus(transcript),
        files: files_read(transcript),
        commands: commands(transcript),
        resources: resources(transcript),
    }
}

/// The latest step, as its row reads.
pub fn focus(transcript: &Transcript) -> Option<Focus> {
    transcript.entries.iter().rev().find_map(|entry| match entry {
        Entry::ToolCall(call) => {
            Some(Focus { kind: call.kind, label: call.label(), path: call.locations.first().map(|location| location.path.clone()), running: call.status.is_running() })
        }
        _ => None,
    })
}

/// Files read or searched and not changed, newest first.
pub fn files_read(transcript: &Transcript) -> Vec<PathBuf> {
    let mut changed: Vec<&PathBuf> = Vec::new();
    let mut files: Vec<PathBuf> = Vec::new();
    for entry in &transcript.entries {
        let Entry::ToolCall(call) = entry else { continue };
        let diffs: Vec<&PathBuf> = call.diffs().map(|(path, _, _)| path).collect();
        if !diffs.is_empty() {
            changed.extend(diffs);
            continue;
        }
        if matches!(call.kind, ToolKind::Read | ToolKind::Search)
            && let Some(location) = call.locations.first()
        {
            files.retain(|path| *path != location.path);
            files.insert(0, location.path.clone());
        }
    }
    files.retain(|path| !changed.contains(&path));
    files
}

/// Commands the agent ran, newest first.
pub fn commands(transcript: &Transcript) -> Vec<CommandRun> {
    let mut runs: Vec<CommandRun> = transcript
        .entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::ToolCall(call) if call.kind == ToolKind::Execute && call.diffs().next().is_none() => {
                let command = call.command().or_else(|| (!call.title.trim().is_empty()).then(|| crate::shell_command::unwrap_shell_command(&call.title)))?;
                Some(CommandRun { tool_call_id: call.id.clone(), command, status: call.status })
            }
            _ => None,
        })
        .collect();
    runs.reverse();
    runs
}

/// Web addresses in `text`, without trailing punctuation.
fn links(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("http://").into_iter().chain(rest.find("https://")).min() {
        let tail = &rest[start..];
        let end = tail.find(|ch: char| ch.is_whitespace() || matches!(ch, '<' | '>' | '(' | ')' | '"' | '\'')).unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ',', ';', ':', '!', '?', ')']);
        if url.len() > "https://".len() {
            found.push(url.to_string());
        }
        rest = &tail[end.max(1)..];
    }
    found
}

/// A `github.com/<owner>/<repo>/pull|issues/<n>` address, as `(repo, kind, number)`.
fn github_reference(url: &str) -> Option<(&str, &str, u64)> {
    let path = url.strip_prefix("https://github.com/").or_else(|| url.strip_prefix("http://github.com/"))?;
    let mut parts = path.split('/');
    let (_owner, repo, kind, number) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    let digits: String = number.chars().take_while(char::is_ascii_digit).collect();
    matches!(kind, "pull" | "issues").then_some(())?;
    Some((repo, kind, digits.parse().ok()?))
}

/// Pull requests, issues and links the messages mention, first mention first.
pub fn resources(transcript: &Transcript) -> Vec<Resource> {
    let mut found: Vec<(String, Resource)> = Vec::new();
    for entry in &transcript.entries {
        let text = match entry {
            Entry::User(message) => &message.text,
            Entry::Agent(message) => &message.text,
            _ => continue,
        };
        for url in links(text) {
            let (id, resource) = match github_reference(&url) {
                Some((repo, kind, number)) => {
                    let base = url.split('/').take(7).collect::<Vec<_>>().join("/");
                    let label = format!("{repo}#{number}");
                    let id = format!("{kind}:{}", base.trim_start_matches("https://github.com/").trim_start_matches("http://github.com/"));
                    let resource = if kind == "pull" { Resource::PullRequest { number, label, url: url.clone() } } else { Resource::Issue { number, label, url: url.clone() } };
                    (id, resource)
                }
                None => {
                    let without_scheme = url.split_once("://").map_or(url.as_str(), |(_, rest)| rest);
                    let label = without_scheme.trim_end_matches('/').split(['?', '#']).next().unwrap_or(without_scheme).to_string();
                    (format!("link:{url}"), Resource::Link { label, url: url.clone() })
                }
            };
            if !found.iter().any(|(existing, _)| *existing == id) {
                found.push((id, resource));
            }
        }
    }
    found.into_iter().map(|(_, resource)| resource).collect()
}

/// The branch checked out in `workspace` (or a folder above it), read from `.git/HEAD`; a short
/// commit id when the head is detached.
pub fn git_branch(workspace: &Path) -> Option<String> {
    let git = workspace.ancestors().map(|dir| dir.join(".git")).find(|git| git.exists())?;
    let git = if git.is_file() {
        // A worktree or submodule: `.git` names the real folder.
        let pointer = std::fs::read_to_string(&git).ok()?;
        let target = pointer.trim().strip_prefix("gitdir:")?.trim();
        let target = PathBuf::from(target);
        if target.is_absolute() { target } else { git.parent()?.join(target) }
    } else {
        git
    };
    let head = std::fs::read_to_string(git.join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: refs/heads/") {
        Some(branch) => Some(branch.to_string()),
        None => Some(head.chars().take(7).collect()),
    }
}

/// A token count as Athas shows it (`formatTokenCount`).
pub fn format_tokens(tokens: u64) -> String {
    format_token_count(tokens)
}

/// `formatTokenCount`, `Intl` compact notation in the user's locale: 850, 1.2k, 12k, 200k, 1M in
/// English (one decimal only from 1,000 to 9,999), `1,2 Mio.` in German; the en-US form where
/// the platform cannot format it.
pub fn format_token_count(tokens: u64) -> String {
    let fraction_digits = usize::from((1_000..10_000).contains(&tokens));
    match crate::locale_format::compact(tokens as f64, fraction_digits) {
        Some(text) => text.strip_suffix('K').map(|number| format!("{number}k")).unwrap_or(text),
        None => format_token_count_en(tokens),
    }
}

/// `format_token_count` as en-US writes it.
pub fn format_token_count_en(tokens: u64) -> String {
    let (value, suffix) = match tokens {
        0..1_000 => return tokens.to_string(),
        1_000..999_500 => (tokens as f64 / 1_000., "k"),
        999_500..999_500_000 => (tokens as f64 / 1_000_000., "M"),
        _ => (tokens as f64 / 1_000_000_000., "B"),
    };
    if tokens < 10_000 { trim_decimal(format!("{value:.1}{suffix}")) } else { format!("{}{suffix}", value.round()) }
}

fn trim_decimal(text: String) -> String {
    text.replace(".0k", "k").replace(".0M", "M")
}

pub fn format_cost(cost: &Cost) -> String {
    let symbol = if cost.currency.eq_ignore_ascii_case("USD") { "$" } else { "" };
    let amount = if cost.amount > 0. && cost.amount < 0.01 { format!("{:.4}", cost.amount) } else { format!("{:.2}", cost.amount) };
    if symbol.is_empty() { format!("{amount} {}", cost.currency) } else { format!("{symbol}{amount}") }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{ToolCall, ToolContent, Usage};

    #[cfg(target_os = "macos")]
    #[test]
    fn token_counts_follow_the_locale() {
        use crate::locale_format::compact_in;
        assert_eq!(compact_in(1_234., 1, "en_US").as_deref(), Some("1.2K"));
        assert_eq!(compact_in(12_345., 0, "en_US").as_deref(), Some("12K"));
        assert_eq!(compact_in(1_250_000., 0, "en_US").as_deref(), Some("1M"));
        assert_eq!(compact_in(1_250_000., 0, "de_DE").as_deref(), Some("1\u{a0}Mio."));
        assert_eq!(compact_in(1_250., 1, "fr_FR").as_deref(), Some("1,3\u{a0}k"));
    }

    #[test]
    fn turn_usage_reads_as_compact_counts() {
        assert_eq!(format_token_count_en(850), "850");
        assert_eq!(format_token_count_en(1_234), "1.2k");
        assert_eq!(format_token_count_en(2_000), "2k");
        assert_eq!(format_token_count_en(12_345), "12k");
        assert_eq!(format_token_count_en(999_999), "1M");
        assert_eq!(format_token_count_en(1_250_000), "1M");
        let usage = crate::thread::TurnUsage { total_tokens: 1_200, input_tokens: 1_000, output_tokens: 200, cached_read_tokens: Some(800), ..Default::default() };
        // In the system locale: "1.2k tokens" in en-US, "1,2k tokens" where the comma is decimal.
        assert_eq!(usage.label(), format!("{} tokens", format_token_count(1_200)));
        assert_eq!(usage.describe(), format!("{} input · 200 output · 800 cache read", format_token_count(1_000)));
        let footer = crate::thread::MessageUsage::from_meta(Some(&serde_json::from_value(serde_json::json!({ "steps": 4, "costUsd": 0.0312 })).unwrap())).unwrap();
        assert_eq!(footer.label().as_deref(), Some("4 steps · $0.03"));
        assert_eq!(crate::thread::MessageUsage { steps: Some(1), cost_cents: Some(0.4) }.label().as_deref(), Some("<$0.01"));
        assert_eq!(crate::thread::MessageUsage { steps: Some(1), cost_cents: None }.label(), None);
    }

    fn edit(id: &str, path: &str, old: Option<&str>, new: &str, status: ToolStatus) -> Entry {
        Entry::ToolCall(ToolCall {
            id: id.into(),
            kind: ToolKind::Edit,
            status,
            content: vec![ToolContent::Diff { path: path.into(), old_text: old.map(str::to_string), new_text: new.into() }],
            ..Default::default()
        })
    }

    #[test]
    fn changes_add_up_per_file_from_first_to_last_state() {
        let mut transcript = Transcript::default();
        transcript.entries.push(edit("1", "/p/a.rs", Some("a\nb\n"), "a\nB\n", ToolStatus::Completed));
        transcript.entries.push(edit("2", "/p/new.rs", None, "x\ny\n", ToolStatus::Completed));
        transcript.entries.push(edit("3", "/p/a.rs", Some("a\nB\n"), "a\nB\nc\n", ToolStatus::Completed));
        transcript.entries.push(edit("4", "/p/rejected.rs", Some("q"), "r", ToolStatus::Canceled));
        transcript.entries.push(edit("5", "/p/same.rs", Some("s\n"), "s\n", ToolStatus::Completed));
        let changes = changes(&transcript);
        assert_eq!(changes.files.len(), 4);
        assert_eq!(
            changes.files[0],
            FileChange { path: "/p/same.rs".into(), additions: 0, deletions: 0, created: false, edits: 1, status: ToolStatus::Completed }
        );
        assert_eq!(
            changes.files[1],
            FileChange { path: "/p/rejected.rs".into(), additions: 1, deletions: 1, created: false, edits: 1, status: ToolStatus::Canceled }
        );
        assert_eq!(
            changes.files[2],
            FileChange { path: "/p/a.rs".into(), additions: 2, deletions: 1, created: false, edits: 2, status: ToolStatus::Completed }
        );
        assert_eq!(
            changes.files[3],
            FileChange { path: "/p/new.rs".into(), additions: 2, deletions: 0, created: true, edits: 1, status: ToolStatus::Completed }
        );
        assert_eq!((changes.additions, changes.deletions), (5, 2));
    }

    #[test]
    fn summaries_carry_usage_plan_cost_and_running_commands() {
        let mut transcript = Transcript::default();
        transcript.plan = vec![
            PlanEntry { content: "Read".into(), status: PlanStatus::Completed },
            PlanEntry { content: "Write".into(), status: PlanStatus::Pending },
        ];
        transcript.usage = Some(Usage {
            used: 50_000,
            size: 200_000,
            cost: Some(Cost { amount: 0.1234, currency: "USD".into() }),
            input_tokens: Some(120_000),
            output_tokens: Some(3_400),
        });
        transcript.entries.push(Entry::ToolCall(ToolCall {
            id: "t".into(),
            kind: ToolKind::Execute,
            status: ToolStatus::InProgress,
            raw_input: Some(serde_json::json!({ "command": "cargo test" })),
            ..Default::default()
        }));
        let summary = summarize(&transcript, None, "Athas Agent".into(), true);
        assert_eq!(summary.context.unwrap().percent(), Some(25.));
        let plan = summary.plan.unwrap();
        assert_eq!((plan.done, plan.current().unwrap().content.as_str()), (1, "Write"));
        assert_eq!(summary.running[0].command, "cargo test");
        assert_eq!(format_cost(summary.cost.unwrap().cost.as_ref().unwrap()), "$0.12");
        assert!(summary.environment.is_none());
    }

    #[test]
    fn reads_the_branch_and_formats_numbers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/feature/dock\n").unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        assert_eq!(git_branch(&dir.path().join("src")).as_deref(), Some("feature/dock"));
        std::fs::write(dir.path().join(".git/HEAD"), "9f2c1abdeadbeef\n").unwrap();
        assert_eq!(git_branch(dir.path()).as_deref(), Some("9f2c1ab"));
        assert_eq!(format_token_count_en(950), "950");
        assert_eq!(format_token_count_en(12_345), "12k");
        assert_eq!(format_token_count_en(2_000_000), "2M");
        assert_eq!(format_cost(&Cost { amount: 0.004, currency: "USD".into() }), "$0.0040");
    }

    #[test]
    fn reads_files_commands_resources_and_focus() {
        use crate::thread::{AgentMessage, Location, ToolContent, UserMessage};
        let mut transcript = Transcript::default();
        let read = |id: &str, path: &str| {
            Entry::ToolCall(ToolCall {
                id: id.into(),
                kind: ToolKind::Read,
                status: ToolStatus::Completed,
                locations: vec![Location { path: path.into(), line: None }],
                ..Default::default()
            })
        };
        transcript.entries.push(Entry::User(UserMessage { text: "Fix https://github.com/acme/app/issues/12 and see https://docs.rs/gpui.".into(), ..Default::default() }));
        transcript.entries.push(read("r1", "/w/a.rs"));
        transcript.entries.push(read("r2", "/w/b.rs"));
        transcript.entries.push(Entry::ToolCall(ToolCall {
            id: "e".into(),
            kind: ToolKind::Edit,
            status: ToolStatus::Completed,
            content: vec![ToolContent::Diff { path: "/w/b.rs".into(), old_text: Some("x".into()), new_text: "y".into() }],
            ..Default::default()
        }));
        transcript.entries.push(Entry::Agent(AgentMessage { text: "Opened https://github.com/acme/app/pull/34/files".into(), ..Default::default() }));
        transcript.entries.push(Entry::ToolCall(ToolCall {
            id: "c".into(),
            kind: ToolKind::Execute,
            status: ToolStatus::InProgress,
            raw_input: Some(serde_json::json!({ "command": "cargo test" })),
            ..Default::default()
        }));
        let summary = summarize(&transcript, None, "Athas Agent".into(), true);
        assert_eq!(summary.files, vec![PathBuf::from("/w/a.rs")]);
        assert_eq!(summary.commands.iter().map(|run| run.command.as_str()).collect::<Vec<_>>(), ["cargo test"]);
        let focus = summary.focus.unwrap();
        assert!(focus.running && focus.label == "cargo test");
        assert_eq!(
            summary.resources,
            vec![
                Resource::Issue { number: 12, label: "app#12".into(), url: "https://github.com/acme/app/issues/12".into() },
                Resource::Link { label: "docs.rs/gpui".into(), url: "https://docs.rs/gpui".into() },
                Resource::PullRequest { number: 34, label: "app#34".into(), url: "https://github.com/acme/app/pull/34/files".into() },
            ]
        );
    }
}

/// What a fork of a session is called: the original's title, marked once however many times it
/// is forked again, so a chain of forks does not grow a tail of them.
pub fn fork_title(title: &str) -> String {
    let base = title.trim();
    let base = base.strip_suffix(" (fork)").unwrap_or(base);
    if base.is_empty() { "Fork".to_string() } else { format!("{base} (fork)") }
}
