//! Agents that run without the user watching: cloud runs on Athas's servers against a GitHub
//! repository (`api`), and continuous agents that work on a goal in a project on a schedule
//! (`continuous`), with their views.

pub mod api;
pub mod composer_notice;
pub mod continuous;
pub mod environment;
pub mod session;
pub mod sidebar;
pub mod transcript;
mod view;

pub use api::{CloudClient, CloudError, CloudRun, RunStatus, StartRun};
pub use continuous::{Cadence, ContinuousAgents, ContinuousEvent, ContinuousTask};
pub use view::{CloudAgentsView, CloudRunView};

/// The centre view kind of the cloud and continuous agents list; its id is the project root the
/// continuous agents section works in, or empty.
pub const RUNS_KIND: &str = "cloud-runs";
/// The centre view kind of one cloud run; its id is the run id.
pub const RUN_KIND: &str = "cloud-run";

/// The agents a cloud run can use.
pub const CLOUD_AGENTS: &[(&str, &str)] = &[("claude-code", "Claude Code"), ("codex", "Codex")];

/// `2026-11-11T10:04:00Z` as `2026-11-11 10:04`.
pub fn short_time(timestamp: &str) -> String {
    let trimmed = timestamp.trim_end_matches('Z');
    let without_seconds = match trimmed.rfind(':') {
        Some(index) if index > 13 => &trimmed[..index],
        _ => trimmed,
    };
    without_seconds.replacen('T', " ", 1)
}

#[cfg(test)]
mod tests {
    #[test]
    fn times_are_shortened() {
        assert_eq!(super::short_time("2026-11-11T10:04:33.120Z"), "2026-11-11 10:04");
        assert_eq!(super::short_time(""), "");
    }
}
