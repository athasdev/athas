//! The `ai.*` commands that act on the session in front (`ai-command-actions.ts`): open the
//! conversation as Markdown, follow the agent, cycle its mode, log out, and open its CLI.

use std::path::PathBuf;

use gpui::{App, Context, actions};

use crate::{
    SessionView,
    acp,
    session_view::AgentState,
    thread::{Entry, NoticeKind, PlanStatus, ToolContent, ToolStatus, Transcript},
};

actions!(
    agent,
    [
        OpenChatTranscript,
        ToggleFollowAgent,
        CycleAgentMode,
        LogOutOfAgent,
        RestartAgent,
        ImportAgentSession,
        OpenAgentCliInTerminal,
        ShowSessionChanges,
        SetProviderApiKey,
    ]
);

pub(crate) fn register(cx: &mut App) {
    keymap::register(cx, "ai.openChatTranscript", OpenChatTranscript);
    keymap::register(cx, "ai.toggleFollowAgent", ToggleFollowAgent);
    keymap::register(cx, "ai.cycleAgentMode", CycleAgentMode);
    keymap::register(cx, "ai.logOutOfAgent", LogOutOfAgent);
    keymap::register(cx, "ai.restartAgent", RestartAgent);
    keymap::register(cx, "ai.importAgentSession", ImportAgentSession);
    keymap::register(cx, "ai.openAgentCliInTerminal", OpenAgentCliInTerminal);
    keymap::register(cx, "ai.showSessionChanges", ShowSessionChanges);
    keymap::register(cx, "ai.setProviderApiKey", SetProviderApiKey);
    cx.on_action(|_: &SetProviderApiKey, cx| workbench_api::open_provider_api_key(cx, None));
}

/// The interactive CLI behind each agent (`agent-clis.ts`), as `(name, command)`. Agents run in
/// the chat; the CLI opens in a terminal only when asked.
pub fn agent_cli(agent: &str) -> Option<(&'static str, &'static str)> {
    Some(match acp::agents::catalog_id(agent) {
        "claude-acp" => ("Claude CLI", "claude"),
        "antigravity-acp" => ("Antigravity CLI", "agy"),
        "gemini-cli" => ("Gemini CLI", "gemini"),
        "github-copilot-cli" => ("GitHub Copilot CLI", "copilot"),
        "kimi-cli" => ("Kimi CLI", "kimi"),
        "opencode" => ("OpenCode", "opencode"),
        "qwen-code" => ("Qwen Code", "qwen"),
        "codex" | "codex-acp" => ("Codex CLI", "codex"),
        _ => return None,
    })
}

fn fenced(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat((longest + 1).max(3));
    format!("{fence}text\n{text}\n{fence}")
}

fn tool_state(status: ToolStatus) -> &'static str {
    match status {
        ToolStatus::Pending => "pending",
        ToolStatus::InProgress => "in_progress",
        ToolStatus::WaitingForPermission => "waiting",
        ToolStatus::Completed => "completed",
        ToolStatus::Failed => "failed",
        ToolStatus::Canceled => "cancelled",
    }
}

/// The conversation and its tool activity as Markdown (`chat-transcript.ts`).
pub fn format_transcript(title: &str, transcript: &Transcript, running: bool) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut messages: Vec<Vec<String>> = Vec::new();
    let mut agent_open = false;
    for entry in &transcript.entries {
        match entry {
            Entry::User(message) => {
                let mut sections = vec!["## You".to_string(), message.text.clone()];
                if !message.attachments.is_empty() {
                    let names: Vec<String> = message.attachments.iter().map(|path| path.display().to_string()).collect();
                    sections.push(format!("Attachments: {}", names.join(", ")));
                }
                messages.push(sections);
                agent_open = false;
            }
            Entry::Notice(notice) if notice.kind != NoticeKind::Info => {
                messages.push(vec!["## System".to_string(), notice.text.clone()]);
                agent_open = false;
            }
            Entry::Notice(_) => {}
            _ => {
                if !agent_open {
                    messages.push(vec!["## Agent".to_string()]);
                    agent_open = true;
                }
                let sections = messages.last_mut().expect("an agent message was just added");
                match entry {
                    Entry::Agent(message) if !message.text.trim().is_empty() => sections.push(message.text.clone()),
                    Entry::Thought(thought) if !thought.text.trim().is_empty() => sections.push(format!("> {}", thought.text.trim().replace('\n', "\n> "))),
                    Entry::ToolCall(call) => {
                        let mut tool = vec![format!("### Tool: {} ({})", call.title.split_whitespace().collect::<Vec<_>>().join(" "), tool_state(call.status))];
                        if let Some(input) = &call.raw_input {
                            tool.push(format!("Input:\n\n{}", fenced(&serde_json::to_string_pretty(input).unwrap_or_default())));
                        }
                        for content in &call.content {
                            match content {
                                ToolContent::Text { text } => tool.push(format!("Output:\n\n{}", fenced(text))),
                                ToolContent::Diff { path, .. } => tool.push(format!("Edited {}", path.display())),
                                ToolContent::Terminal { .. } => {}
                            }
                        }
                        if let Some(output) = &call.terminal_output {
                            tool.push(format!("Terminal output:\n\n{}", fenced(output)));
                        }
                        sections.push(tool.join("\n\n"));
                    }
                    _ => {}
                }
            }
        }
    }
    if running && agent_open && let Some(sections) = messages.last_mut() {
        sections[0].push_str(" (in progress)");
    }
    if !transcript.plan.is_empty() {
        let steps: Vec<String> = transcript
            .plan
            .iter()
            .map(|step| format!("- [{}] {}", if step.status == PlanStatus::Completed { "x" } else { " " }, step.content))
            .collect();
        if let Some(sections) = messages.last_mut() {
            sections.push(format!("### Plan\n\n{}", steps.join("\n")));
        }
    }
    let mut parts = vec![format!("# {}", if title.is_empty() { "Untitled agent" } else { &title })];
    parts.extend(messages.into_iter().map(|sections| sections.join("\n\n")));
    parts.join("\n\n---\n\n") + "\n"
}

fn transcripts_dir() -> PathBuf {
    std::env::temp_dir().join("athas-agent-transcripts")
}

fn file_name(title: &str) -> String {
    let name: String = title.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { '_' }).collect();
    let name = name.trim();
    format!("{}.md", if name.is_empty() { "Agent" } else { name })
}

impl SessionView {
    pub fn open_chat_transcript(&mut self, cx: &mut Context<Self>) {
        let title = self.info.title.trim().to_string();
        let markdown = format_transcript(&title, &self.transcript, self.is_running());
        let dir = transcripts_dir().join(&self.info.id);
        let path = dir.join(file_name(&title));
        let written = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&path, markdown));
        match written {
            Ok(()) => workbench_api::open_file(cx, path, None),
            Err(error) => {
                notifications::error(cx, "Could not open the conversation", Some(error.to_string().into()));
            }
        }
    }

    pub fn toggle_follow_agent(&mut self, cx: &mut Context<Self>) {
        self.toggle_follow(cx);
        notifications::info(cx, if self.following { "Following the agent" } else { "Stopped following the agent" });
    }

    pub fn cycle_mode(&mut self, cx: &mut Context<Self>) {
        let next = self.transcript.modes.as_ref().filter(|modes| modes.available.len() > 1).and_then(|modes| {
            let index = modes.available.iter().position(|mode| mode.id == modes.current).map_or(0, |index| (index + 1) % modes.available.len());
            modes.available.get(index).cloned()
        });
        match next {
            Some(mode) => {
                self.set_mode(mode.id.clone(), cx);
                notifications::info(cx, format!("Mode: {}", mode.name));
            }
            None => {
                notifications::info(cx, "This agent has no other modes.");
            }
        }
    }

    pub fn log_out_of_agent(&mut self, cx: &mut Context<Self>) {
        let AgentState::Ready(agent) = &self.agent else {
            notifications::info(cx, "Start the agent first; its sign-in is checked when it runs.");
            return;
        };
        if !agent.connection.supports_logout() {
            notifications::info(cx, format!("{} can't log out from Athas.", self.agent_name()));
            return;
        }
        let connection = agent.connection.clone();
        cx.spawn(async move |_, cx| {
            let result = connection.logout().await;
            cx.update(|cx| match result {
                Ok(()) => {
                    notifications::info(cx, "Logged out of the agent");
                }
                Err(error) => {
                    notifications::error(cx, "Couldn't log out of the agent", Some(error.to_string().into()));
                }
            });
        })
        .detach();
    }

    pub fn show_changes(&mut self, cx: &mut Context<Self>) {
        self.open_review(cx);
    }

    pub fn open_agent_cli(&mut self, cx: &mut Context<Self>) {
        let Some((_, command)) = agent_cli(&self.info.agent) else {
            notifications::info(cx, format!("{} has no CLI to open.", self.agent_name()));
            return;
        };
        workbench_api::run_in_terminal(cx, command, self.info.cwd.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{AgentMessage, PlanEntry, ToolCall, UserMessage};

    #[test]
    fn the_transcript_reads_as_markdown() {
        let mut transcript = Transcript::default();
        transcript.entries.push(Entry::User(UserMessage { text: "Fix the build".into(), ..Default::default() }));
        transcript.entries.push(Entry::Agent(AgentMessage { text: "Looking at it.".into(), ..Default::default() }));
        transcript.entries.push(Entry::ToolCall(ToolCall {
            title: "cargo   check".into(),
            status: ToolStatus::Completed,
            terminal_output: Some("ok ```".into()),
            ..Default::default()
        }));
        transcript.plan.push(PlanEntry { content: "Run tests".into(), status: PlanStatus::Completed });
        let markdown = format_transcript("  Build   fix ", &transcript, true);
        assert!(markdown.starts_with("# Build fix\n\n---\n\n## You\n\nFix the build"));
        assert!(markdown.contains("## Agent (in progress)\n\nLooking at it.\n\n### Tool: cargo check (completed)"));
        assert!(markdown.contains("````text\nok ```\n````"));
        assert!(markdown.contains("### Plan\n\n- [x] Run tests"));
        assert_eq!(file_name("a/b: c"), "a_b_ c.md");
    }

    #[test]
    fn agents_open_their_own_cli() {
        assert_eq!(agent_cli("claude-code"), Some(("Claude CLI", "claude")));
        assert_eq!(agent_cli("codex"), Some(("Codex CLI", "codex")));
        assert_eq!(agent_cli("athas"), None);
    }
}
