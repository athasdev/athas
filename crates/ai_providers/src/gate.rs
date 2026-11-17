//! The team and organization checks an AI task makes before it connects
//! (`getIntelligenceConnection`, `assertIntelligenceConnectionAllowed`): team models that could
//! not be read are not swapped for personal ones, and an organization in managed mode turns off
//! the agent (`aiChatEnabled`), every other task (`aiCompletionEnabled`) or personal keys
//! (`allowByok`).
//!
//! The app publishes what it knows (`set_connection_gate`) whenever the team scope or the
//! account's policy changes, so callers that only hold settings, such as commit messages, pull
//! request drafts, Tab completion and the built-in agent, get the same answer as the views that
//! read the account themselves.

use std::sync::RwLock;

use crate::catalog;

/// What the app last published about the team scope and the organization's policy.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ConnectionGate {
    /// A team scope is chosen but its settings are loading or could not be read.
    pub team_unavailable: bool,
    /// Managed mode without `allowByok`: only Athas's hosted models may run.
    pub byok_disabled: bool,
    /// Managed mode without `aiChatEnabled`: the built-in agent may not run.
    pub chat_disabled: bool,
    /// Managed mode without `aiCompletionEnabled`: Tab completion, inline edit, commit messages,
    /// titles, drafts and review summaries may not run.
    pub completion_disabled: bool,
}

/// Which policy switch a task answers to: the agent to `aiChatEnabled`, every other task
/// (`IntelligenceTask`) to `aiCompletionEnabled`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateTask {
    Agent,
    Text,
}

pub const TEAM_UNAVAILABLE: &str = "Team settings are unavailable. Select personal settings or reconnect.";
pub const BYOK_DISABLED: &str = "This AI connection is disabled by your organization.";

static GATE: RwLock<ConnectionGate> =
    RwLock::new(ConnectionGate { team_unavailable: false, byok_disabled: false, chat_disabled: false, completion_disabled: false });

pub fn set_connection_gate(gate: ConnectionGate) {
    if let Ok(mut current) = GATE.write() {
        *current = gate;
    }
}

pub fn connection_gate() -> ConnectionGate {
    GATE.read().map(|gate| *gate).unwrap_or_default()
}

impl ConnectionGate {
    /// Whether a text task (anything but the agent) may run on `provider_id`, or why not.
    pub fn check(&self, provider_id: &str) -> Result<(), &'static str> {
        self.check_task(GateTask::Text, provider_id)
    }

    /// Whether `task` may run on `provider_id`, or why not, in the original's wording.
    pub fn check_task(&self, task: GateTask, provider_id: &str) -> Result<(), &'static str> {
        if self.team_unavailable {
            return Err(TEAM_UNAVAILABLE);
        }
        let task_disabled = match task {
            GateTask::Agent => self.chat_disabled,
            GateTask::Text => self.completion_disabled,
        };
        if task_disabled || (self.byok_disabled && provider_id != catalog::ATHAS) {
            return Err(BYOK_DISABLED);
        }
        Ok(())
    }
}

/// [`ConnectionGate::check`] against what the app last published.
pub fn check_connection(provider_id: &str) -> Result<(), &'static str> {
    connection_gate().check(provider_id)
}

/// [`ConnectionGate::check_task`] against what the app last published.
pub fn check_task_connection(task: GateTask, provider_id: &str) -> Result<(), &'static str> {
    connection_gate().check_task(task, provider_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn team_and_byok_checks() {
        assert_eq!(ConnectionGate::default().check("openai"), Ok(()));
        let team = ConnectionGate { team_unavailable: true, ..Default::default() };
        assert_eq!(team.check(catalog::ATHAS), Err(TEAM_UNAVAILABLE));
        let managed = ConnectionGate { byok_disabled: true, ..Default::default() };
        assert_eq!(managed.check("anthropic"), Err(BYOK_DISABLED));
        assert_eq!(managed.check(catalog::ATHAS), Ok(()));
    }

    #[test]
    fn task_switches() {
        let chat_off = ConnectionGate { chat_disabled: true, ..Default::default() };
        assert_eq!(chat_off.check_task(GateTask::Agent, catalog::ATHAS), Err(BYOK_DISABLED));
        assert_eq!(chat_off.check_task(GateTask::Text, catalog::ATHAS), Ok(()));
        let completion_off = ConnectionGate { completion_disabled: true, ..Default::default() };
        assert_eq!(completion_off.check(catalog::ATHAS), Err(BYOK_DISABLED));
        assert_eq!(completion_off.check_task(GateTask::Agent, "openai"), Ok(()));
    }
}
