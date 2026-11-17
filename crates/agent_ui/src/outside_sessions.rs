//! Conversations an agent keeps for a project that no Athas session holds, such as a Claude Code
//! CLI run (`services/outside-agent-sessions.ts`, `lib/import-agent-session.ts`). The agent lists
//! them over `session/list`; importing one opens a session that loads it with `session/load`, so
//! the agent replays its history into the transcript. Codex threads come the same way, through
//! the Codex bridge's `session/list` over `thread/list`.

use std::path::PathBuf;

#[cfg(not(target_family = "wasm"))]
use gpui::AppContext as _;
use gpui::{App, Task};

/// The agents asked for their sessions.
pub const LISTING_AGENTS: &[&str] = &["claude-code", crate::codex::AGENT_ID];

#[derive(Clone, Debug, PartialEq)]
pub struct OutsideSession {
    pub agent: String,
    pub session_id: String,
    pub title: String,
    /// ISO 8601, as the agent sent it.
    pub updated_at: String,
    /// The agent deletes its sessions (`sessionCapabilities.delete`).
    pub deletable: bool,
}

impl OutsideSession {
    /// When the agent last touched it, in Unix milliseconds; 0 when it did not say.
    pub fn updated_ms(&self) -> u64 {
        chrono::DateTime::parse_from_rfc3339(&self.updated_at).map_or(0, |date| date.timestamp_millis().max(0) as u64)
    }
}

/// How long the sidebar's list of a project's outside sessions stays fresh.
const SIDEBAR_STALE: std::time::Duration = std::time::Duration::from_secs(5 * 60);

type Lister = std::rc::Rc<dyn Fn(PathBuf, &mut App) -> Task<Vec<OutsideSession>>>;

#[derive(Default)]
struct Listed {
    sessions: Vec<OutsideSession>,
    fetched: Option<web_time::Instant>,
    loading: bool,
}

/// The outside sessions the sidebar shows under the active project (`use-outside-agent-sessions.ts`),
/// cached a few minutes per project. Nothing is listed until the app enables it, so tests and
/// headless renders never start an agent.
#[derive(Default)]
struct SidebarListing {
    lister: Option<Lister>,
    projects: std::collections::HashMap<PathBuf, Listed>,
}

impl gpui::Global for SidebarListing {}

/// Lets the sidebar ask the installed agents for their sessions.
pub fn enable_sidebar_listing(cx: &mut App) {
    set_sidebar_lister(std::rc::Rc::new(list), cx);
}

/// Lists outside sessions for the sidebar with `lister` (fake agents in tests).
pub fn set_sidebar_lister(lister: Lister, cx: &mut App) {
    let listing = cx.default_global::<SidebarListing>();
    listing.lister = Some(lister);
    listing.projects.clear();
}

/// The outside sessions of `project` the sidebar lists, newest first; a stale or missing list is
/// fetched in the background and the windows redrawn when it arrives.
pub fn sidebar_sessions(project: &std::path::Path, cx: &mut App) -> Vec<OutsideSession> {
    let Some(listing) = cx.try_global::<SidebarListing>() else { return Vec::new() };
    let Some(lister) = listing.lister.clone() else { return Vec::new() };
    let listed = listing.projects.get(project);
    let sessions = listed.map(|listed| listed.sessions.clone()).unwrap_or_default();
    let stale = listed.is_none_or(|listed| !listed.loading && listed.fetched.is_none_or(|fetched| fetched.elapsed() >= SIDEBAR_STALE));
    if stale {
        let project = project.to_path_buf();
        cx.global_mut::<SidebarListing>().projects.entry(project.clone()).or_default().loading = true;
        cx.defer(move |cx| {
            let task = lister(project.clone(), cx);
            cx.spawn(async move |cx| {
                let sessions = task.await;
                cx.update(|cx| {
                    let listed = cx.default_global::<SidebarListing>().projects.entry(project).or_default();
                    listed.sessions = sessions;
                    listed.fetched = Some(web_time::Instant::now());
                    listed.loading = false;
                    cx.refresh_windows();
                });
            })
            .detach();
        });
    }
    sessions
}

/// Drops a session from the sidebar's lists once Athas holds it.
pub fn forget_sidebar_session(session_id: &str, cx: &mut App) {
    if cx.has_global::<SidebarListing>() {
        for listed in cx.global_mut::<SidebarListing>().projects.values_mut() {
            listed.sessions.retain(|session| session.session_id != session_id);
        }
    }
}

/// Sorts newest first and leaves out sessions an Athas session already holds.
pub fn without_held(mut sessions: Vec<OutsideSession>, held: &[String]) -> Vec<OutsideSession> {
    sessions.retain(|session| !held.contains(&session.session_id));
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions
}

/// Agent session ids saved Athas sessions hold.
pub fn held_sessions() -> Vec<String> {
    let Some(dir) = crate::persistence::sessions_dir() else { return Vec::new() };
    crate::history::list(&dir)
        .into_iter()
        .filter_map(|session| {
            crate::history::load(&session.id)?.agent_session_id
        })
        .collect()
}

/// The Athas session holding each agent session, by the agent's session id.
pub fn holders() -> std::collections::HashMap<String, String> {
    let Some(dir) = crate::persistence::sessions_dir() else { return Default::default() };
    crate::history::list(&dir)
        .into_iter()
        .filter_map(|session| Some((crate::history::load(&session.id)?.agent_session_id?, session.id)))
        .collect()
}

/// One page of the agents' own sessions for the history (`agent-sessions-dialog.tsx loadPage`):
/// what each agent listed, in agent order and newest first within it, and where each agent with
/// more to list goes on.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionPage {
    pub sessions: Vec<OutsideSession>,
    /// `(agent, cursor)` for each agent with a next page.
    pub next: Vec<(String, String)>,
    /// An installed agent that could not list, as the line the history shows for it
    /// (`agent-sessions-dialog.tsx FieldError`).
    pub errors: Vec<String>,
}

/// The first page from every agent that lists its sessions, or, with `next`, the following page
/// of each agent that has one. Sessions Athas holds stay in, so they can be opened.
#[cfg(not(target_family = "wasm"))]
pub fn list_page(cwd: PathBuf, next: Option<Vec<(String, String)>>, cx: &mut App) -> Task<SessionPage> {
    let executor = cx.background_executor().clone();
    cx.background_spawn(async move {
        let requests: Vec<(String, Option<String>)> = match next {
            Some(next) => next.into_iter().map(|(agent, cursor)| (agent, Some(cursor))).collect(),
            None => LISTING_AGENTS.iter().map(|agent| (agent.to_string(), None)).collect(),
        };
        let mut page = SessionPage::default();
        for (agent, cursor) in requests {
            match list_agent_page(&agent, &cwd, cursor, &executor).await {
                Ok((mut found, more)) => {
                    found.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
                    page.sessions.extend(found);
                    if let Some(more) = more {
                        page.next.push((agent, more));
                    }
                }
                Err(error) => page.errors.push(format!("Could not list {} sessions: {error}", crate::acp::agents::display_name(&agent))),
            }
        }
        page
    })
}

#[cfg(target_family = "wasm")]
pub fn list_page(_cwd: PathBuf, _next: Option<Vec<(String, String)>>, _cx: &mut App) -> Task<SessionPage> {
    Task::ready(SessionPage::default())
}

/// Asks each installed agent that lists its sessions for those in `cwd`. An agent that is not
/// installed or cannot list adds nothing instead of failing the rest.
#[cfg(not(target_family = "wasm"))]
pub fn list(cwd: PathBuf, cx: &mut App) -> Task<Vec<OutsideSession>> {
    let executor = cx.background_executor().clone();
    cx.background_spawn(async move {
        let mut sessions = Vec::new();
        for agent in LISTING_AGENTS {
            match list_agent(agent, &cwd, &executor).await {
                Ok(found) => sessions.extend(found),
                Err(error) => eprintln!("Could not list {agent} sessions: {error}"),
            }
        }
        without_held(sessions, &held_sessions())
    })
}

#[cfg(target_family = "wasm")]
pub fn list(_cwd: PathBuf, _cx: &mut App) -> Task<Vec<OutsideSession>> {
    Task::ready(Vec::new())
}

/// Deletes one of an agent's own sessions with `session/delete` (`agent-sessions-dialog.tsx`).
#[cfg(not(target_family = "wasm"))]
pub fn delete(session: &OutsideSession, cwd: PathBuf, cx: &mut App) -> Task<Result<(), String>> {
    let executor = cx.background_executor().clone();
    let (agent, session_id) = (session.agent.clone(), session.session_id.clone());
    cx.background_spawn(async move {
        let Some(agent) = connect(&agent, &cwd, &executor).await? else { return Err("The agent is not installed".into()) };
        let result = if agent.connection.supports_session_delete() {
            agent.connection.delete_session(&session_id).await.map_err(|error| error.to_string())
        } else {
            Err("This agent can't delete its sessions".into())
        };
        agent.connection.close();
        result
    })
}

#[cfg(target_family = "wasm")]
pub fn delete(_session: &OutsideSession, _cwd: PathBuf, _cx: &mut App) -> Task<Result<(), String>> {
    Task::ready(Err("Agents run in the desktop app".into()))
}

/// An agent started only to answer about its sessions; dropping it stops it.
#[cfg(not(target_family = "wasm"))]
struct ListingAgent {
    connection: std::sync::Arc<crate::acp::client::AgentConnection>,
    _tasks: Vec<gpui::Task<()>>,
    _process: crate::acp::process::AgentProcess,
}

/// Starts `agent` in `cwd` and initializes it; `None` when it is not installed. Codex runs as
/// its app-server behind the in-process ACP bridge, as its sessions do.
#[cfg(not(target_family = "wasm"))]
async fn connect(agent: &str, cwd: &std::path::Path, executor: &gpui::BackgroundExecutor) -> Result<Option<ListingAgent>, String> {
    use crate::acp::{self, agents::Resolution, client::AgentConnection};
    let mut tasks = Vec::new();
    let (process, transport) = if crate::codex::is_codex(agent) {
        let Some(program) = crate::codex::resolve() else { return Ok(None) };
        let command = acp::agents::AgentCommand { program, args: crate::codex::ARGS.iter().map(|arg| arg.to_string()).collect(), env: Vec::new() };
        let (process, codex_transport) = acp::process::AgentProcess::spawn(&command, cwd).map_err(|error| error.to_string())?;
        let config = crate::codex::CodexConfig { cwd: cwd.to_path_buf(), settings: crate::codex::CodexSettings::load(), browser_tool: None, host: None, save_settings: None };
        let (client_end, agent_end) = acp::rpc::Transport::pair();
        tasks.push(executor.spawn(crate::codex::serve(agent_end, codex_transport, config)));
        (process, client_end)
    } else {
        let command = match acp::agents::resolve(agent) {
            Resolution::Found(command) => command,
            Resolution::NotInstalled { .. } => return Ok(None),
        };
        acp::process::AgentProcess::spawn_recorded(&command, cwd, None).map_err(|error| error.to_string())?
    };
    let (connection, _events, io) = AgentConnection::new(transport, None);
    tasks.push(executor.spawn(io));
    connection.initialize().await.map_err(|error| error.to_string())?;
    Ok(Some(ListingAgent { connection, _tasks: tasks, _process: process }))
}

#[cfg(not(target_family = "wasm"))]
async fn list_agent(agent: &str, cwd: &std::path::Path, executor: &gpui::BackgroundExecutor) -> Result<Vec<OutsideSession>, String> {
    let Some(listing) = connect(agent, cwd, executor).await? else { return Ok(Vec::new()) };
    let connection = &listing.connection;
    let result = if connection.supports_session_list() { connection.list_sessions(cwd).await.map_err(|error| error.to_string()) } else { Ok(Vec::new()) };
    let deletable = connection.supports_session_delete();
    connection.close();
    Ok(outside(agent, result?, deletable))
}

/// One page of `agent`'s sessions from `cursor`, and the next page's cursor.
#[cfg(not(target_family = "wasm"))]
async fn list_agent_page(agent: &str, cwd: &std::path::Path, cursor: Option<String>, executor: &gpui::BackgroundExecutor) -> Result<(Vec<OutsideSession>, Option<String>), String> {
    let Some(listing) = connect(agent, cwd, executor).await? else { return Ok((Vec::new(), None)) };
    let connection = &listing.connection;
    let result = if connection.supports_session_list() { connection.list_sessions_page(cwd, cursor).await.map_err(|error| error.to_string()) } else { Ok((Vec::new(), None)) };
    let deletable = connection.supports_session_delete();
    connection.close();
    let (sessions, next) = result?;
    Ok((outside(agent, sessions, deletable), next))
}

#[cfg(not(target_family = "wasm"))]
fn outside(agent: &str, sessions: Vec<crate::acp::schema::SessionInfo>, deletable: bool) -> Vec<OutsideSession> {
    let name = crate::acp::agents::display_name(agent);
    sessions
        .into_iter()
        .map(|session| OutsideSession {
            agent: agent.to_string(),
            session_id: session.session_id.0.to_string(),
            title: session.title.as_deref().and_then(crate::title::clean_chat_title).unwrap_or_else(|| format!("{name} session")),
            updated_at: session.updated_at.unwrap_or_default(),
            deletable,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn held_sessions_are_left_out_and_the_rest_sorted() {
        let session = |id: &str, at: &str| OutsideSession { agent: "claude-code".into(), session_id: id.into(), title: id.into(), updated_at: at.into(), deletable: false };
        let sessions = vec![session("a", "2026-01-01T00:00:00Z"), session("b", "2026-03-01T00:00:00Z"), session("c", "2026-02-01T00:00:00Z")];
        let left = without_held(sessions, &["c".to_string()]);
        assert_eq!(left.iter().map(|session| session.session_id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(left[0].updated_ms(), 1_772_323_200_000);
    }

    #[gpui::test]
    fn the_sidebar_lists_each_project_once_until_stale(cx: &mut gpui::TestAppContext) {
        let project = std::path::Path::new("/projects/app");
        assert!(cx.update(|cx| sidebar_sessions(project, cx)).is_empty());
        let calls = std::rc::Rc::new(std::cell::Cell::new(0));
        cx.update(|cx| {
            let calls = calls.clone();
            set_sidebar_lister(
                std::rc::Rc::new(move |cwd, _| {
                    calls.set(calls.get() + 1);
                    let session = OutsideSession {
                        agent: "claude-code".into(),
                        session_id: "cli-1".into(),
                        title: format!("Run in {}", cwd.display()),
                        updated_at: "2026-11-01T00:00:00Z".into(),
                        deletable: true,
                    };
                    Task::ready(vec![session])
                }),
                cx,
            )
        });
        assert!(cx.update(|cx| sidebar_sessions(project, cx)).is_empty());
        cx.run_until_parked();
        let listed = cx.update(|cx| sidebar_sessions(project, cx));
        assert_eq!(listed.iter().map(|session| session.title.as_str()).collect::<Vec<_>>(), ["Run in /projects/app"]);
        assert_eq!(calls.get(), 1);
        cx.update(|cx| forget_sidebar_session("cli-1", cx));
        assert!(cx.update(|cx| sidebar_sessions(project, cx)).is_empty());
        cx.run_until_parked();
        assert_eq!(calls.get(), 1);
    }
}
