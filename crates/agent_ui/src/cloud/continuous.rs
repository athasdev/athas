//! Continuous agents: a goal an agent works on in a project on a schedule (every 15 minutes,
//! hourly, every 4 hours or daily). Tasks are saved in `dev.athas.gpui/continuous-agents.json`;
//! when one is due in an open project, [`ContinuousAgents`] asks the workbench to start a session
//! with its prompt (`ContinuousEvent::Launch`).
//!
//! Ported from Athas's `continuous-agents/{continuous-agents.store,continuous-agent-schedule,
//! continuous-agent-runner}.ts`.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use gpui::{App, AppContext as _, Context, Entity, EventEmitter, Global, Task};
use web_time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

pub const NAME_MAX: usize = 80;
pub const PROMPT_MAX: usize = 20_000;
/// How often due tasks are looked for.
const CHECK_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cadence {
    #[serde(rename = "15m")]
    Quarter,
    #[serde(rename = "hourly")]
    Hourly,
    #[serde(rename = "4h")]
    FourHours,
    #[serde(rename = "daily")]
    Daily,
}

impl Cadence {
    pub const ALL: [Cadence; 4] = [Cadence::Quarter, Cadence::Hourly, Cadence::FourHours, Cadence::Daily];

    pub fn minutes(self) -> u64 {
        match self {
            Cadence::Quarter => 15,
            Cadence::Hourly => 60,
            Cadence::FourHours => 240,
            Cadence::Daily => 1_440,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Cadence::Quarter => "Every 15 min",
            Cadence::Hourly => "Hourly",
            Cadence::FourHours => "Every 4h",
            Cadence::Daily => "Daily",
        }
    }

    pub fn next_run(self, from: u64) -> u64 {
        from + self.minutes() * 60_000
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousTask {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub agent_id: String,
    pub workspace_path: PathBuf,
    pub cadence: Cadence,
    pub enabled: bool,
    pub created_at: u64,
    pub next_run_at: u64,
    pub last_run_at: Option<u64>,
    pub last_session_id: Option<String>,
    pub run_count: u64,
    pub last_error: Option<String>,
    /// The latest runs, newest first.
    #[serde(default)]
    pub runs: Vec<TaskRun>,
}

/// One run of a continuous agent, for its run history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    pub started_at: u64,
    pub session_id: Option<String>,
}

/// Runs a task's history keeps.
const MAX_RUNS: usize = 20;

pub fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |duration| duration.as_millis() as u64)
}

/// "Ready now", "in 12m", "in 3h", "in 2d".
pub fn format_next_run(at: u64, now: u64) -> String {
    let remaining = at.saturating_sub(now);
    if remaining <= 30_000 {
        return "Ready now".into();
    }
    let minutes = remaining.div_ceil(60_000);
    if minutes < 60 {
        return format!("in {minutes}m");
    }
    let hours = minutes.div_ceil(60);
    if hours < 24 {
        return format!("in {hours}h");
    }
    format!("in {}d", hours.div_ceil(24))
}

/// The prompt a run of the task sends.
/// Goals a new continuous agent can start from (`GOAL_TEMPLATES`), as `(name, prompt)`.
pub const GOAL_TEMPLATES: [(&str, &str); 3] = [
    ("Keep tests green", "Run the relevant test suites, investigate failures, and fix regressions without changing intentional behavior."),
    (
        "Watch dependencies",
        "Review dependency health and security signals. Apply safe updates, verify compatibility, and summarize anything that needs a decision.",
    ),
    ("Improve the codebase", "Find one high-leverage quality improvement in the current workspace, implement it with focused scope, and verify the result."),
];

pub fn build_prompt(name: &str, prompt: &str) -> String {
    format!(
        "You are running the continuous goal \u{201c}{name}\u{201d} in this workspace.\nMake meaningful progress autonomously, verify the result, and leave a concise handoff in this session.\nIf the goal is already satisfied, inspect the current state and report evidence instead of inventing work.\n\n{prompt}"
    )
}

/// The saved tasks.
#[derive(Default)]
pub struct TaskList {
    path: Option<PathBuf>,
    pub tasks: Vec<ContinuousTask>,
}

impl TaskList {
    /// Reads the tasks from `path` (none when it is `None` or unreadable).
    pub fn load(path: Option<PathBuf>) -> Self {
        let tasks = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Vec<ContinuousTask>>(&text).ok())
            .unwrap_or_default();
        Self { path, tasks }
    }

    pub fn default_path() -> Option<PathBuf> {
        crate::persistence::sessions_dir().and_then(|dir| dir.parent().map(|parent| parent.join("continuous-agents.json")))
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&self.tasks) {
            let _ = std::fs::write(path, bytes);
        }
    }

    pub fn create(&mut self, name: &str, prompt: &str, agent_id: &str, workspace: &Path, cadence: Cadence, now: u64) -> Result<String, String> {
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        let prompt = prompt.trim();
        if name.is_empty() || name.chars().count() > NAME_MAX {
            return Err(format!("Names must be between 1 and {NAME_MAX} characters."));
        }
        if prompt.is_empty() || prompt.chars().count() > PROMPT_MAX {
            return Err("Goals must be between 1 and 20,000 characters.".into());
        }
        if agent_id.trim().is_empty() || workspace.as_os_str().is_empty() {
            return Err("Pick an agent and a project.".into());
        }
        let id = format!("continuous-{now:x}-{}", self.tasks.len());
        self.tasks.insert(
            0,
            ContinuousTask {
                id: id.clone(),
                name,
                prompt: prompt.to_string(),
                agent_id: agent_id.trim().to_string(),
                workspace_path: workspace.to_path_buf(),
                cadence,
                enabled: true,
                created_at: now,
                next_run_at: now,
                last_run_at: None,
                last_session_id: None,
                run_count: 0,
                last_error: None,
                runs: Vec::new(),
            },
        );
        self.save();
        Ok(id)
    }

    fn change(&mut self, id: &str, change: impl FnOnce(&mut ContinuousTask)) {
        if let Some(task) = self.tasks.iter_mut().find(|task| task.id == id) {
            change(task);
            self.save();
        }
    }

    pub fn delete(&mut self, id: &str) {
        self.tasks.retain(|task| task.id != id);
        self.save();
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool, now: u64) {
        self.change(id, |task| {
            task.enabled = enabled;
            if enabled {
                task.last_error = None;
                task.next_run_at = task.cadence.next_run(now);
            }
        });
    }

    /// Runs the task at the next check.
    pub fn request_run(&mut self, id: &str, now: u64) {
        self.change(id, |task| {
            task.enabled = true;
            task.next_run_at = now;
            task.last_error = None;
        });
    }

    /// The most overdue enabled task of `workspace`, marked as run and scheduled again.
    pub fn claim_due(&mut self, workspace: &Path, now: u64) -> Option<ContinuousTask> {
        let task = self.tasks.iter_mut().filter(|task| task.enabled && task.workspace_path == workspace && task.next_run_at <= now).min_by_key(|task| task.next_run_at)?;
        task.last_run_at = Some(now);
        task.next_run_at = task.cadence.next_run(now);
        task.run_count += 1;
        task.last_error = None;
        task.runs.insert(0, TaskRun { started_at: now, session_id: None });
        task.runs.truncate(MAX_RUNS);
        let claimed = task.clone();
        self.save();
        Some(claimed)
    }

    pub fn attach_session(&mut self, id: &str, session: &str) {
        self.change(id, |task| {
            task.last_session_id = Some(session.to_string());
            if let Some(run) = task.runs.first_mut().filter(|run| run.session_id.is_none()) {
                run.session_id = Some(session.to_string());
            }
        });
    }

    pub fn pause(&mut self, id: &str, reason: &str) {
        let reason = reason.trim();
        self.change(id, |task| {
            task.enabled = false;
            task.last_error = Some(if reason.is_empty() { "Unable to start agent.".into() } else { reason.to_string() });
        });
    }
}

/// Whether the task's agent can run here; `Err` says why not.
pub fn readiness(task: &ContinuousTask) -> Result<(), String> {
    if crate::builtin::is_builtin(&task.agent_id) {
        return Ok(());
    }
    #[cfg(not(target_family = "wasm"))]
    {
        match crate::acp::agents::resolve(&task.agent_id) {
            crate::acp::agents::Resolution::Found(_) => Ok(()),
            crate::acp::agents::Resolution::NotInstalled { name, .. } => Err(format!("{name} is not installed.")),
        }
    }
    #[cfg(target_family = "wasm")]
    Err("Agents run in the desktop app".into())
}

#[derive(Clone, Debug, PartialEq)]
pub enum ContinuousEvent {
    /// Start a session of `task.agent_id` in `task.workspace_path` with `prompt`, then call
    /// `ContinuousAgents::attach_session` with its id.
    Launch { task: ContinuousTask, prompt: String },
}

/// The app's continuous agents and the timer that launches due ones in open projects.
pub struct ContinuousAgents {
    list: TaskList,
    open_projects: Vec<PathBuf>,
    _timer: Option<Task<()>>,
}

impl EventEmitter<ContinuousEvent> for ContinuousAgents {}

struct GlobalContinuous(Entity<ContinuousAgents>);

impl Global for GlobalContinuous {}

impl ContinuousAgents {
    pub fn global(cx: &mut App) -> Entity<Self> {
        if let Some(global) = cx.try_global::<GlobalContinuous>() {
            return global.0.clone();
        }
        let path = if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() { None } else { TaskList::default_path() };
        let entity = cx.new(|cx| Self::new(TaskList::load(path), cx));
        cx.set_global(GlobalContinuous(entity.clone()));
        entity
    }

    pub fn set_global(entity: Entity<Self>, cx: &mut App) {
        cx.set_global(GlobalContinuous(entity));
    }

    pub fn new(list: TaskList, cx: &mut Context<Self>) -> Self {
        let timer = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(CHECK_INTERVAL).await;
                if this.update(cx, |this, cx| this.launch_due(cx)).is_err() {
                    return;
                }
            }
        });
        Self { list, open_projects: Vec::new(), _timer: Some(timer) }
    }

    pub fn tasks(&self) -> &[ContinuousTask] {
        &self.list.tasks
    }

    /// The projects open in the workbench: only their tasks run.
    pub fn set_open_projects(&mut self, projects: Vec<PathBuf>, cx: &mut Context<Self>) {
        self.open_projects = projects;
        self.launch_due(cx);
    }

    pub fn create(&mut self, name: &str, prompt: &str, agent_id: &str, workspace: &Path, cadence: Cadence, cx: &mut Context<Self>) -> Result<String, String> {
        let id = self.list.create(name, prompt, agent_id, workspace, cadence, now_millis())?;
        cx.notify();
        Ok(id)
    }

    pub fn delete(&mut self, id: &str, cx: &mut Context<Self>) {
        self.list.delete(id);
        cx.notify();
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool, cx: &mut Context<Self>) {
        self.list.set_enabled(id, enabled, now_millis());
        cx.notify();
    }

    pub fn run_now(&mut self, id: &str, cx: &mut Context<Self>) {
        self.list.request_run(id, now_millis());
        self.launch_due(cx);
        cx.notify();
    }

    pub fn attach_session(&mut self, id: &str, session: &str, cx: &mut Context<Self>) {
        self.list.attach_session(id, session);
        cx.notify();
    }

    pub fn pause(&mut self, id: &str, reason: &str, cx: &mut Context<Self>) {
        self.list.pause(id, reason);
        cx.notify();
    }

    /// Launches at most one due task per open project, waiting while any agent is busy, and says
    /// so in a toast (`ContinuousAgentsRuntime`).
    fn launch_due(&mut self, cx: &mut Context<Self>) {
        let now = now_millis();
        for project in self.open_projects.clone() {
            if crate::session_view::SessionView::any_busy(cx) {
                break;
            }
            let Some(due) = self.list.tasks.iter().filter(|task| task.enabled && task.workspace_path == project && task.next_run_at <= now).min_by_key(|task| task.next_run_at).cloned()
            else {
                continue;
            };
            if let Err(reason) = readiness(&due) {
                self.list.pause(&due.id, &reason);
                notifications::error(cx, format!("{} was paused", due.name), Some(reason.into()));
                continue;
            }
            if let Some(task) = self.list.claim_due(&project, now) {
                let prompt = build_prompt(&task.name, &task.prompt);
                notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, format!("{} started", task.name), Some("The run is open in a fresh Agent session.".into()), None);
                cx.emit(ContinuousEvent::Launch { task, prompt });
            }
        }
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tasks_are_validated_scheduled_and_saved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("continuous.json");
        let mut list = TaskList::load(Some(path.clone()));
        let project = Path::new("/code/app");
        assert!(list.create("", "x", "athas", project, Cadence::Hourly, 0).is_err());
        assert!(list.create("n", &"x".repeat(PROMPT_MAX + 1), "athas", project, Cadence::Hourly, 0).is_err());
        let id = list.create("  Keep   CI green ", "Fix failing tests", "athas", project, Cadence::Hourly, 1_000).unwrap();
        assert_eq!(list.tasks[0].name, "Keep CI green");

        assert!(list.claim_due(Path::new("/other"), 1_000).is_none());
        let claimed = list.claim_due(project, 2_000).unwrap();
        assert_eq!((claimed.run_count, claimed.next_run_at), (1, 2_000 + 3_600_000));
        assert!(list.claim_due(project, 3_000).is_none());

        list.pause(&id, "Gemini CLI is not installed.");
        assert!(!list.tasks[0].enabled);
        list.request_run(&id, 5_000);
        assert!(list.tasks[0].enabled && list.tasks[0].last_error.is_none());

        let reloaded = TaskList::load(Some(path));
        assert_eq!(reloaded.tasks, list.tasks);
    }

    #[test]
    fn next_runs_read_naturally() {
        assert_eq!(format_next_run(10_000, 0), "Ready now");
        assert_eq!(format_next_run(12 * 60_000, 0), "in 12m");
        assert_eq!(format_next_run(3 * 3_600_000, 0), "in 3h");
        assert_eq!(format_next_run(50 * 3_600_000, 0), "in 3d");
        assert!(build_prompt("Goal", "Do it").ends_with("\n\nDo it"));
        assert_eq!(serde_json::to_value(Cadence::Quarter).unwrap(), "15m");
    }

    #[test]
    fn builtin_agents_are_always_ready() {
        let task = ContinuousTask {
            id: "t".into(),
            name: "n".into(),
            prompt: "p".into(),
            agent_id: "athas".into(),
            workspace_path: "/p".into(),
            cadence: Cadence::Daily,
            enabled: true,
            created_at: 0,
            next_run_at: 0,
            last_run_at: None,
            last_session_id: None,
            run_count: 0,
            last_error: None,
            runs: Vec::new(),
        };
        assert_eq!(readiness(&task), Ok(()));
    }
}
