//! Why the agent's turn ended early: a limit it hit, or a refusal, said under the reply with a
//! title and what to do next. A turn cut short by a limit offers Continue.
//!
//! Ported from Athas's `lib/agent-stop-notice.ts` and `components/messages/agent-stop-notice.tsx`.

use crate::{
    acp::schema,
    thread::{Entry, ToolStatus},
};

/// What the chat sends when the user asks the agent to pick up where it stopped.
pub const CONTINUE_PROMPT: &str = "Continue";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopNotice {
    MaxTokens,
    MaxTurnRequests,
    PromptRefused,
    Refused,
}

const ALL: [StopNotice; 4] = [StopNotice::MaxTokens, StopNotice::MaxTurnRequests, StopNotice::PromptRefused, StopNotice::Refused];

impl StopNotice {
    pub fn title(self) -> &'static str {
        match self {
            StopNotice::MaxTokens => "The response hit the model's output limit",
            StopNotice::MaxTurnRequests => "The agent reached its request limit for this turn",
            StopNotice::PromptRefused => "The agent refused this prompt",
            StopNotice::Refused => "The agent refused to continue",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            StopNotice::MaxTokens => "The reply was cut off. Continue to let the agent pick up where it stopped.",
            StopNotice::MaxTurnRequests => "It stopped before finishing. Continue to let it keep going.",
            StopNotice::PromptRefused => "Rephrase the request and send it again.",
            StopNotice::Refused => "It stopped after reviewing tool output.",
        }
    }

    /// A turn cut short by a limit can be resumed (`getAgentStopFollowUpActions`).
    pub fn can_continue(self) -> bool {
        matches!(self, StopNotice::MaxTokens | StopNotice::MaxTurnRequests)
    }

    /// The text the transcript keeps: the title, then the description on its own line.
    pub fn text(self) -> String {
        format!("{}\n{}", self.title(), self.description())
    }

    /// The notice a transcript's warning text was written for.
    pub fn from_text(text: &str) -> Option<Self> {
        let title = text.lines().next()?;
        ALL.into_iter().find(|notice| notice.title() == title)
    }
}

/// The notice for a stop reason (`getAgentStopNotice`); `end_turn` and `cancelled` are ordinary
/// endings and need none. A refusal after a completed tool call that returned output came from
/// what the tool returned, as Zed reads it.
pub fn for_stop(reason: schema::StopReason, turn: &[Entry]) -> Option<StopNotice> {
    match reason {
        schema::StopReason::MaxTokens => Some(StopNotice::MaxTokens),
        schema::StopReason::MaxTurnRequests => Some(StopNotice::MaxTurnRequests),
        schema::StopReason::Refusal => Some(if refused_after_tool_output(turn) { StopNotice::Refused } else { StopNotice::PromptRefused }),
        _ => None,
    }
}

fn refused_after_tool_output(turn: &[Entry]) -> bool {
    turn.iter().any(|entry| matches!(entry, Entry::ToolCall(call) if call.status == ToolStatus::Completed && (call.raw_output.is_some() || !call.content.is_empty())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_reasons_read_as_notices() {
        assert_eq!(for_stop(schema::StopReason::EndTurn, &[]), None);
        assert_eq!(for_stop(schema::StopReason::Cancelled, &[]), None);
        assert_eq!(for_stop(schema::StopReason::MaxTokens, &[]), Some(StopNotice::MaxTokens));
        assert_eq!(for_stop(schema::StopReason::Refusal, &[]), Some(StopNotice::PromptRefused));
        let call = crate::thread::ToolCall { status: ToolStatus::Completed, raw_output: Some(serde_json::json!("secret")), ..Default::default() };
        assert_eq!(for_stop(schema::StopReason::Refusal, &[Entry::ToolCall(call)]), Some(StopNotice::Refused));
        for notice in ALL {
            assert_eq!(StopNotice::from_text(&notice.text()), Some(notice));
        }
        assert!(StopNotice::MaxTurnRequests.can_continue() && !StopNotice::Refused.can_continue());
        assert_eq!(StopNotice::from_text("Stopped"), None);
    }
}
