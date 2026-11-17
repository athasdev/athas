//! What a cloud run's surfaces say about it: the branch it starts from, the order of
//! repositories, its time and credit, and what to do when it cannot start.
//!
//! Ported from Athas's `cloud-agents/services/cloud-environment.ts`.

use super::api::{CloudError, CloudRepo, CloudRun, RunStatus};

/// The branch a cloud run starts from when the user has not picked one: the branch checked out
/// here when the remote has it, otherwise the repository's default branch. Without a branch list
/// the checked-out branch is the best guess.
pub fn pick_default_branch(local: Option<&str>, remote: Option<(Option<&str>, &[String])>) -> Option<String> {
    let local = local.filter(|branch| !branch.is_empty());
    let Some((default, branches)) = remote else { return local.map(str::to_string) };
    if let Some(local) = local
        && branches.iter().any(|branch| branch == local)
    {
        return Some(local.to_string());
    }
    default.map(str::to_string).or_else(|| branches.first().cloned()).or_else(|| local.map(str::to_string))
}

/// The project's own repository first, then the most recently pushed; the project's repository is
/// added when the list does not have it.
pub fn order_repos(mut repos: Vec<CloudRepo>, project_repo: Option<&str>) -> Vec<CloudRepo> {
    let project = project_repo.map(str::to_lowercase);
    let is_project = |repo: &CloudRepo| project.as_deref() == Some(repo.full_name.to_lowercase().as_str());
    let pushed = |repo: &CloudRepo| repo.pushed_at.as_deref().map_or(0, timestamp_millis);
    repos.sort_by(|left, right| is_project(right).cmp(&is_project(left)).then_with(|| pushed(right).cmp(&pushed(left))));
    if let Some(project_repo) = project_repo
        && !repos.iter().any(is_project)
    {
        repos.insert(0, CloudRepo { full_name: project_repo.to_string(), default_branch: None, private: false, pushed_at: None });
    }
    repos
}

fn timestamp_millis(timestamp: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(timestamp).map_or(0, |date| date.timestamp_millis())
}

/// Credit a run has spent, in millionths of a dollar.
pub fn run_spent_micros(run: &CloudRun) -> u64 {
    run.spent_micros.unwrap_or(run.charged_cents * 10_000)
}

/// Seconds the run's sandbox has been up: measured while it runs, billed once it ends.
pub fn run_sandbox_seconds(run: &CloudRun, now_millis: i64) -> u64 {
    if run.status == RunStatus::Running
        && let Some(started) = run.started_at.as_deref().and_then(|started| chrono::DateTime::parse_from_rfc3339(started).ok())
    {
        return ((now_millis - started.timestamp_millis()).max(0) / 1000) as u64;
    }
    run.billed_seconds
}

pub fn format_sandbox_time(seconds: u64) -> String {
    if seconds < 60 {
        return format!("{seconds}s");
    }
    let minutes = seconds / 60;
    if minutes < 60 {
        return format!("{minutes}m {:02}s", seconds % 60);
    }
    format!("{}h {:02}m", minutes / 60, minutes % 60)
}

pub fn format_credit_micros(micros: u64) -> String {
    let dollars = micros as f64 / 1_000_000.;
    if dollars > 0. && dollars < 0.01 { "<$0.01".into() } else { format!("${dollars:.2}") }
}

/// `https://github.com/owner/repo/pull/12…` as (`owner/repo`, 12).
pub fn parse_pull_request_url(url: &str) -> Option<(String, u64)> {
    let rest = url.strip_prefix("https://github.com/")?;
    let mut parts = rest.splitn(5, '/');
    let (owner, repo, kind, number) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    if owner.is_empty() || repo.is_empty() || kind != "pull" {
        return None;
    }
    let digits: String = number.chars().take_while(char::is_ascii_digit).collect();
    Some((format!("{owner}/{repo}"), digits.parse().ok()?))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProblemAction {
    SignIn,
    ConnectGithub,
    OpenBilling,
    SeePlans,
    Retry,
}

/// What to tell the user about a run that could not start, and the one thing that fixes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloudProblem {
    pub title: String,
    pub description: String,
    pub action: Option<(ProblemAction, &'static str)>,
}

pub fn describe_problem(error: &CloudError) -> CloudProblem {
    let problem = |title: &str, description: &str, action| CloudProblem { title: title.into(), description: description.into(), action: Some(action) };
    let (code, message) = match error {
        CloudError::SignedOut => return problem("Sign in to Athas", &error.to_string(), (ProblemAction::SignIn, "Sign in")),
        CloudError::Http { code, message, .. } => (code.as_deref(), message.as_str()),
        CloudError::Unavailable(message) => (None, message.as_str()),
    };
    let or = |fallback: &str| if message.trim().is_empty() { fallback.to_string() } else { message.to_string() };
    match code {
        Some("github_not_connected") => problem(
            "Connect GitHub",
            "Cloud agents clone your repository and open a pull request through GitHub.",
            (ProblemAction::ConnectGithub, "Connect GitHub"),
        ),
        Some("allowance_exhausted") => problem("Out of Athas credit", "Add credit to keep running agents in the cloud.", (ProblemAction::OpenBilling, "Add credit")),
        Some("spend_cap_reached") => {
            problem("Spend limit reached", "Raise your monthly spend limit in billing to start another run.", (ProblemAction::OpenBilling, "Open billing"))
        }
        Some("pro_required") => problem(
            "Cloud agents are part of Athas Pro",
            "Upgrade to run agents in the cloud and get a pull request back.",
            (ProblemAction::SeePlans, "See plans"),
        ),
        Some("model_unavailable") => {
            CloudProblem { title: "Model unavailable".into(), description: or("This model cannot run in the cloud right now."), action: Some((ProblemAction::Retry, "Try again")) }
        }
        _ => CloudProblem {
            title: "The run could not start".into(),
            description: or("Cloud agents are temporarily unavailable."),
            action: Some((ProblemAction::Retry, "Try again")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str, pushed: Option<&str>) -> CloudRepo {
        CloudRepo { full_name: name.into(), default_branch: None, private: false, pushed_at: pushed.map(str::to_string) }
    }

    #[test]
    fn the_default_branch_prefers_the_checked_out_one_the_remote_has() {
        let branches = vec!["main".to_string(), "feature".to_string()];
        assert_eq!(pick_default_branch(Some("feature"), Some((Some("main"), &branches))).as_deref(), Some("feature"));
        assert_eq!(pick_default_branch(Some("local-only"), Some((Some("main"), &branches))).as_deref(), Some("main"));
        assert_eq!(pick_default_branch(Some("local-only"), Some((None, &branches))).as_deref(), Some("main"));
        assert_eq!(pick_default_branch(Some("local-only"), Some((None, &[]))).as_deref(), Some("local-only"));
        assert_eq!(pick_default_branch(Some("dev"), None).as_deref(), Some("dev"));
        assert_eq!(pick_default_branch(None, None), None);
    }

    #[test]
    fn repos_put_the_project_first_then_the_latest_pushed() {
        let repos = vec![repo("a/old", Some("2026-01-01T00:00:00Z")), repo("a/new", Some("2026-11-01T00:00:00Z")), repo("Me/Project", None)];
        let names: Vec<_> = order_repos(repos.clone(), Some("me/project")).into_iter().map(|repo| repo.full_name).collect();
        assert_eq!(names, ["Me/Project", "a/new", "a/old"]);
        let names: Vec<_> = order_repos(repos, Some("me/missing")).into_iter().map(|repo| repo.full_name).collect();
        assert_eq!(names, ["me/missing", "a/new", "a/old", "Me/Project"]);
    }

    #[test]
    fn time_and_credit_read_plainly() {
        assert_eq!(format_sandbox_time(42), "42s");
        assert_eq!(format_sandbox_time(125), "2m 05s");
        assert_eq!(format_sandbox_time(3_660), "1h 01m");
        assert_eq!(format_credit_micros(0), "$0.00");
        assert_eq!(format_credit_micros(4_000), "<$0.01");
        assert_eq!(format_credit_micros(1_250_000), "$1.25");
        let run = CloudRun { charged_cents: 12, billed_seconds: 90, ..Default::default() };
        assert_eq!(run_spent_micros(&run), 120_000);
        assert_eq!(run_sandbox_seconds(&run, 0), 90);
        let running = CloudRun { status: RunStatus::Running, started_at: Some("2026-11-12T00:00:00Z".into()), ..Default::default() };
        let now = timestamp_millis("2026-11-12T00:01:05Z");
        assert_eq!(run_sandbox_seconds(&running, now), 65);
    }

    #[test]
    fn pull_request_urls_are_read() {
        assert_eq!(parse_pull_request_url("https://github.com/athasdev/athas/pull/42/files"), Some(("athasdev/athas".into(), 42)));
        assert_eq!(parse_pull_request_url("https://github.com/athasdev/athas/issues/42"), None);
        assert_eq!(parse_pull_request_url("https://example.com/a/b/pull/1"), None);
    }

    #[test]
    fn problems_name_the_fix() {
        let http = |code: &str, message: &str| CloudError::Http { status: 402, code: Some(code.into()), message: message.into() };
        assert_eq!(describe_problem(&http("allowance_exhausted", "")).action, Some((ProblemAction::OpenBilling, "Add credit")));
        assert_eq!(describe_problem(&http("pro_required", "")).title, "Cloud agents are part of Athas Pro");
        assert_eq!(describe_problem(&http("model_unavailable", "")).description, "This model cannot run in the cloud right now.");
        let other = describe_problem(&CloudError::Unavailable("Down".into()));
        assert_eq!((other.title.as_str(), other.description.as_str()), ("The run could not start", "Down"));
        assert_eq!(describe_problem(&CloudError::SignedOut).action.map(|action| action.0), Some(ProblemAction::SignIn));
    }
}
