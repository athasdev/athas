//! Follow-up chips after a turn (`lib/follow-up-actions.ts`, `chat-follow-up-actions.tsx`): the
//! prompt asks the agent to end each answer with a hidden `[FOLLOW_UP_ACTIONS]` block of one to
//! three short actions; the block is cut from the shown text and its actions become buttons that
//! send their prompt.

use ui::IconName;

const START: &str = "[FOLLOW_UP_ACTIONS]";
const END: &str = "[/FOLLOW_UP_ACTIONS]";
const ICONS: &[&str] =
    &["ArrowRight", "Bug", "CheckCircle", "FileText", "GitBranch", "Search", "Play", "Rocket", "ShieldCheck", "Stack", "Terminal", "Upload", "WarningCircle", "Wrench"];

#[derive(Clone, Debug, PartialEq)]
pub struct FollowUp {
    pub label: String,
    pub prompt: String,
    pub icon: &'static str,
}

impl FollowUp {
    pub fn icon_name(&self) -> IconName {
        match self.icon {
            "Bug" => IconName::Bug,
            "CheckCircle" => IconName::CheckCircle,
            "FileText" => IconName::FileText,
            "GitBranch" => IconName::GitBranch,
            "Search" => IconName::Search,
            "Play" => IconName::Play,
            "Rocket" => IconName::Rocket,
            "ShieldCheck" => IconName::ShieldCheck,
            "Stack" => IconName::Stack,
            "Terminal" => IconName::Terminal,
            "Upload" => IconName::Upload,
            "WarningCircle" => IconName::WarningCircle,
            "Wrench" => IconName::Wrench,
            _ => IconName::ArrowRight,
        }
    }
}

/// What the prompt asks the agent for, after the context and before the user's words.
pub fn instruction() -> String {
    format!(
        "At the very end of each assistant response, include a hidden follow-up action block:\n\n{START}\n[\n  {{\"label\":\"Run tests\",\"prompt\":\"Run the relevant tests and verify this change.\",\"icon\":\"ShieldCheck\"}}\n]\n{END}\n\nRules for follow-up actions:\n- Generate 1-3 actions that fit the work you just completed or the next likely user intent.\n- Each action must be a short UI button, not a sentence.\n- Each prompt must be the exact message to send if the user clicks it.\n- Pick an icon from this app icon set only: {}.\n- Do not mention the follow-up block in the visible response.",
        ICONS.join(", ")
    )
}

/// The user's own words in a prompt Athas sent (`stripAcpContextPreamble`): the context before
/// them always ends with [`instruction`] and a blank line, so everything up to there goes. Text
/// without that preamble comes back unchanged.
pub fn strip_context_preamble(text: &str) -> &str {
    let end = format!("{}\n\n", instruction());
    if let Some(index) = text.find(&end) {
        return &text[index + end.len()..];
    }
    // A preamble from another version (a different icon list): its last rule still ends it.
    if let Some(index) = text.find(PREAMBLE_LAST_RULE) {
        return text[index + PREAMBLE_LAST_RULE.len()..].trim_start();
    }
    text
}

/// The last line of [`instruction`].
const PREAMBLE_LAST_RULE: &str = "- Do not mention the follow-up block in the visible response.";

/// Whether `text` is (the start of) the context Athas puts before a prompt, rather than words
/// the user wrote: an agent that titles a session by its first prompt sees this first.
pub fn is_context_preamble(text: &str) -> bool {
    let text = text.trim_start();
    ["Athas ACP client integrations:", "Team instructions:", "At the very end of each assistant response, include a hidden follow-up"]
        .iter()
        .any(|start| text.starts_with(start))
        || (text.starts_with("Project: ") && text.contains("Working directory:"))
}

fn find_ignore_case(haystack: &str, needle: &str) -> Option<usize> {
    haystack.to_ascii_lowercase().find(&needle.to_ascii_lowercase())
}

/// The text to show, and the actions of a complete block. An unfinished block (still streaming)
/// is hidden too.
pub fn extract(text: &str) -> (String, Vec<FollowUp>) {
    let Some(start) = find_ignore_case(text, START) else { return (text.to_string(), Vec::new()) };
    let after = &text[start + START.len()..];
    let Some(end) = find_ignore_case(after, END) else { return (text[..start].trim_end().to_string(), Vec::new()) };
    let visible = format!("{}{}", &text[..start], &after[end + END.len()..]).trim_end().to_string();
    (visible, parse(&after[..end]))
}

fn parse(json: &str) -> Vec<FollowUp> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(json.trim()) else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            let label = item.get("label")?.as_str()?.trim();
            let prompt = item.get("prompt")?.as_str()?.trim();
            if label.is_empty() || prompt.is_empty() {
                return None;
            }
            let icon = item.get("icon").and_then(|icon| icon.as_str()).and_then(|icon| ICONS.iter().find(|known| **known == icon)).copied().unwrap_or("ArrowRight");
            Some(FollowUp { label: label.chars().take(28).collect(), prompt: prompt.to_string(), icon })
        })
        .take(3)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_are_cut_and_read() {
        let text = "Done.\n\n[FOLLOW_UP_ACTIONS]\n[{\"label\":\"Run tests\",\"prompt\":\"Run them.\",\"icon\":\"ShieldCheck\"},{\"label\":\"x\",\"prompt\":\"\"},{\"label\":\"Ship it now please today\",\"prompt\":\"Ship.\",\"icon\":\"Nope\"}]\n[/FOLLOW_UP_ACTIONS]";
        let (visible, actions) = extract(text);
        assert_eq!(visible, "Done.");
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].icon_name(), IconName::ShieldCheck);
        assert_eq!(actions[1].icon, "ArrowRight");
        assert_eq!(extract("Working [FOLLOW_UP_ACTIONS]\n[{\"lab").0, "Working");
        assert_eq!(extract("Plain").0, "Plain");
    }

    #[test]
    fn replayed_prompts_drop_the_context_before_the_user_words() {
        let sent = format!("Project: p\nWorking directory: /p\n\n{}\n\nFix it", instruction());
        assert_eq!(strip_context_preamble(&sent), "Fix it");
        assert_eq!(strip_context_preamble("Fix it"), "Fix it");
    }
}
