//! `/agent`, `/ask` and `/plan` from the composer: agents name their modes freely, so each mode
//! is read for the three intents every chat offers.
//!
//! Ported from Athas's `lib/composer-modes.ts` and `lib/composer-slash-commands.ts`.

use crate::thread::Transcript;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModeIntent {
    Agent,
    Ask,
    Plan,
}

pub const MODE_COMMANDS: [(ModeIntent, &str, &str); 3] = [
    (ModeIntent::Agent, "agent", "Switch to Agent mode: edit files and run tools"),
    (ModeIntent::Ask, "ask", "Switch to Ask mode: answer without changing files"),
    (ModeIntent::Plan, "plan", "Switch to Plan mode: propose a plan first"),
];

const AGENT_WORDS: [&str; 8] = ["default", "agent", "code", "auto", "build", "normal", "edit", "edits"];

/// Where a pick goes: the agent's session modes or its "mode" config option.
#[derive(Clone, Debug, PartialEq)]
pub enum ModeTarget {
    Mode,
    Config(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModeOption {
    pub id: String,
    pub label: String,
    pub intent: Option<ModeIntent>,
}

fn mode_words(text: &str) -> Vec<String> {
    let mut spaced = String::new();
    let mut previous_lower = false;
    for c in text.chars() {
        if previous_lower && c.is_ascii_uppercase() {
            spaced.push(' ');
        }
        previous_lower = c.is_ascii_lowercase();
        spaced.push(c);
    }
    spaced.to_lowercase().split(|c: char| !c.is_ascii_lowercase()).filter(|word| !word.is_empty()).map(str::to_string).collect()
}

/// The intent a mode's id and name read as, as `inferModeIntent`.
pub fn infer_mode_intent(id: &str, name: &str) -> Option<ModeIntent> {
    let words = mode_words(&format!("{id} {name}"));
    let has = |word: &str| words.iter().any(|candidate| candidate == word);
    if has("plan") || has("planning") {
        return Some(ModeIntent::Plan);
    }
    let read_only = has("readonly") || (has("read") && has("only"));
    if read_only || words.first().is_some_and(|word| word == "ask" || word == "chat") {
        return Some(ModeIntent::Ask);
    }
    words.iter().any(|word| AGENT_WORDS.contains(&word.as_str())).then_some(ModeIntent::Agent)
}

/// The session's modes and where a pick goes: a "mode" config option wins over session modes.
pub fn mode_options(transcript: &Transcript) -> (Vec<ModeOption>, ModeTarget) {
    if let Some(option) = transcript.config_options.iter().find(|option| option.category.as_deref() == Some("mode") && !option.choices.is_empty()) {
        let options = option
            .choices
            .iter()
            .map(|choice| ModeOption { id: choice.value.clone(), label: if choice.name.is_empty() { choice.value.clone() } else { choice.name.clone() }, intent: infer_mode_intent(&choice.value, &choice.name) })
            .collect();
        return (options, ModeTarget::Config(option.id.clone()));
    }
    let options = transcript
        .modes
        .iter()
        .flat_map(|modes| modes.available.iter())
        .map(|mode| ModeOption { id: mode.id.clone(), label: if mode.name.is_empty() { mode.id.clone() } else { mode.name.clone() }, intent: infer_mode_intent(&mode.id, &mode.name) })
        .collect();
    (options, ModeTarget::Mode)
}

/// The mode an intent picks. Without a match only "agent" falls back: the first mode that is
/// neither planning nor read-only.
pub fn find_mode_for_intent(options: &[ModeOption], intent: ModeIntent) -> Option<&ModeOption> {
    options.iter().find(|option| option.intent == Some(intent)).or_else(|| {
        (intent == ModeIntent::Agent).then(|| options.iter().find(|option| !matches!(option.intent, Some(ModeIntent::Plan | ModeIntent::Ask)))).flatten()
    })
}

/// The mode commands the session offers: one per intent a mode matches, unless the agent has a
/// command of that name.
pub fn available_mode_commands(transcript: &Transcript) -> Vec<(ModeIntent, &'static str, &'static str)> {
    let (options, _) = mode_options(transcript);
    MODE_COMMANDS
        .into_iter()
        .filter(|(intent, name, _)| find_mode_for_intent(&options, *intent).is_some() && !transcript.commands.iter().any(|command| command.name.eq_ignore_ascii_case(name)))
        .collect()
}

/// A message starting with a mode command, such as "/plan add dark mode": the intent and the
/// prompt to send in it.
pub fn parse_leading_mode_command(text: &str, transcript: &Transcript) -> Option<(ModeIntent, String)> {
    let rest = text.trim_start().strip_prefix('/')?;
    let (name, prompt) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    if name.is_empty() || name.contains('/') {
        return None;
    }
    let (intent, _, _) = available_mode_commands(transcript).into_iter().find(|(_, command, _)| command.eq_ignore_ascii_case(name))?;
    Some((intent, prompt.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{AvailableCommand, Mode, ModeState};

    fn modes(list: &[(&str, &str)]) -> Transcript {
        Transcript {
            modes: Some(ModeState {
                current: list[0].0.into(),
                available: list.iter().map(|(id, name)| Mode { id: (*id).into(), name: (*name).into(), description: None }).collect(),
            }),
            ..Default::default()
        }
    }

    #[test]
    fn modes_read_as_intents() {
        assert_eq!(infer_mode_intent("acceptEdits", "Accept Edits"), Some(ModeIntent::Agent));
        assert_eq!(infer_mode_intent("plan", "Plan Mode"), Some(ModeIntent::Plan));
        assert_eq!(infer_mode_intent("read-only", "Read only"), Some(ModeIntent::Ask));
        assert_eq!(infer_mode_intent("bypassPermissions", "Bypass Permissions"), None);
    }

    #[test]
    fn leading_mode_commands_switch_and_send_the_rest() {
        let transcript = modes(&[("default", "Default"), ("plan", "Plan Mode")]);
        assert_eq!(parse_leading_mode_command("/plan add dark mode", &transcript), Some((ModeIntent::Plan, "add dark mode".into())));
        assert_eq!(parse_leading_mode_command("/agent", &transcript), Some((ModeIntent::Agent, String::new())));
        assert_eq!(parse_leading_mode_command("/ask why", &transcript), None);
        assert_eq!(parse_leading_mode_command("/compact", &transcript), None);

        let mut own = transcript.clone();
        own.commands.push(AvailableCommand { name: "plan".into(), description: String::new(), hint: None });
        assert_eq!(parse_leading_mode_command("/plan x", &own), None);
    }
}
