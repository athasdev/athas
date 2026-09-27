//! Bookkeeping for running agents: which connection serves which (agent, workspace), which
//! connection holds each open session, and the startups other chats can join. None of it
//! touches processes, so the rules are tested on their own.

use anyhow::{Result, bail};
use std::{
   collections::HashMap,
   hash::{Hash, Hasher},
   path::PathBuf,
   time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

/// One agent process serves every chat that uses the same agent in the same workspace. Two keys
/// are the same workspace when their folders are the same on disk, so a folder opened through a
/// symlink shares the process started through its real path.
#[derive(Debug, Clone)]
pub(super) struct ConnectionKey {
   pub agent_id: String,
   /// The resolved workspace the process runs in, as the app named it; `None` without a project.
   pub workspace_path: Option<PathBuf>,
   /// Where `workspace_path` really is, with symlinks resolved when possible.
   pub workspace_identity: Option<PathBuf>,
}

impl ConnectionKey {
   pub fn new(agent_id: String, workspace_path: Option<PathBuf>) -> Self {
      let workspace_identity = workspace_path
         .as_ref()
         .map(|path| std::fs::canonicalize(path).unwrap_or_else(|_| path.clone()));
      Self {
         agent_id,
         workspace_path,
         workspace_identity,
      }
   }
}

impl PartialEq for ConnectionKey {
   fn eq(&self, other: &Self) -> bool {
      self.agent_id == other.agent_id && self.workspace_identity == other.workspace_identity
   }
}

impl Eq for ConnectionKey {
}

impl Hash for ConnectionKey {
   fn hash<H: Hasher>(&self, state: &mut H) {
      self.agent_id.hash(state);
      self.workspace_identity.hash(state);
   }
}

#[derive(Debug)]
struct SessionEntry {
   connection_id: u64,
   prompt_running: bool,
}

/// Which connection holds each open ACP session, and whether a prompt turn runs in it. Session
/// ids come from the agents; every agent Athas knows uses unique ids, so a session lives on one
/// connection at a time.
#[derive(Debug, Default)]
pub(super) struct SessionRegistry {
   sessions: HashMap<String, SessionEntry>,
}

impl SessionRegistry {
   /// Records that `connection_id` holds `session_id`. Returns the connection that held it
   /// before, if it moved.
   pub fn attach(&mut self, session_id: &str, connection_id: u64) -> Option<u64> {
      let previous = self.sessions.insert(
         session_id.to_string(),
         SessionEntry {
            connection_id,
            prompt_running: false,
         },
      );
      previous
         .map(|entry| entry.connection_id)
         .filter(|previous| *previous != connection_id)
   }

   pub fn connection_of(&self, session_id: &str) -> Option<u64> {
      self
         .sessions
         .get(session_id)
         .map(|entry| entry.connection_id)
   }

   pub fn is_open_on(&self, session_id: &str, connection_id: u64) -> bool {
      self.connection_of(session_id) == Some(connection_id)
   }

   /// Forgets a closed or deleted session. Returns the connection that held it.
   pub fn detach(&mut self, session_id: &str) -> Option<u64> {
      self
         .sessions
         .remove(session_id)
         .map(|entry| entry.connection_id)
   }

   /// The sessions `connection_id` holds, sorted so status updates are stable.
   pub fn sessions_of(&self, connection_id: u64) -> Vec<String> {
      let mut sessions: Vec<String> = self
         .sessions
         .iter()
         .filter(|(_, entry)| entry.connection_id == connection_id)
         .map(|(session_id, _)| session_id.clone())
         .collect();
      sessions.sort();
      sessions
   }

   /// Forgets every session of a connection that went away and returns them.
   pub fn remove_connection(&mut self, connection_id: u64) -> Vec<String> {
      let sessions = self.sessions_of(connection_id);
      for session_id in &sessions {
         self.sessions.remove(session_id);
      }
      sessions
   }

   /// Marks a prompt turn as running in `session_id` and returns its connection. ACP allows one
   /// turn per session at a time; other sessions on the same connection are not affected.
   pub fn begin_prompt(&mut self, session_id: &str) -> Result<u64> {
      let Some(entry) = self.sessions.get_mut(session_id) else {
         bail!("The agent session {session_id} is not open");
      };
      if entry.prompt_running {
         bail!("The agent is still answering the previous prompt in this chat");
      }
      entry.prompt_running = true;
      Ok(entry.connection_id)
   }

   pub fn end_prompt(&mut self, session_id: &str) {
      if let Some(entry) = self.sessions.get_mut(session_id) {
         entry.prompt_running = false;
      }
   }

   /// Whether any session on `connection_id` is running a prompt turn.
   pub fn has_running_prompt(&self, connection_id: u64) -> bool {
      self
         .sessions
         .values()
         .any(|entry| entry.connection_id == connection_id && entry.prompt_running)
   }
}

struct PendingStartup<W> {
   id: u64,
   token: CancellationToken,
   waiters: Vec<W>,
}

/// Agent startups in progress, one per connection key. A chat that needs an agent that is
/// already starting waits for that startup instead of starting a second process.
pub(super) struct Startups<W> {
   next_id: u64,
   pending: HashMap<ConnectionKey, PendingStartup<W>>,
}

impl<W> Default for Startups<W> {
   fn default() -> Self {
      Self {
         next_id: 0,
         pending: HashMap::new(),
      }
   }
}

impl<W> Startups<W> {
   /// Queues `waiter` on the startup for `key`. Returns the id and stop token of a startup the
   /// caller must begin, or `None` when one is already running.
   pub fn join(&mut self, key: ConnectionKey, waiter: W) -> Option<(u64, CancellationToken)> {
      if let Some(pending) = self.pending.get_mut(&key) {
         pending.waiters.push(waiter);
         return None;
      }
      self.next_id += 1;
      let token = CancellationToken::new();
      self.pending.insert(
         key,
         PendingStartup {
            id: self.next_id,
            token: token.clone(),
            waiters: vec![waiter],
         },
      );
      Some((self.next_id, token))
   }

   /// Stops the startup for `key` and hands back its waiters to be told. `None` when nothing was
   /// starting.
   pub fn stop(&mut self, key: &ConnectionKey) -> Option<Vec<W>> {
      self.pending.remove(key).map(|pending| {
         pending.token.cancel();
         pending.waiters
      })
   }

   /// Stops every startup, for when every agent is being stopped.
   pub fn stop_all(&mut self) -> Vec<W> {
      let keys: Vec<ConnectionKey> = self.pending.keys().cloned().collect();
      keys
         .iter()
         .filter_map(|key| self.stop(key))
         .flatten()
         .collect()
   }

   /// Startup `id` for `key` finished. Returns its waiters when it is still wanted; `None` when
   /// it was stopped, so the caller shuts the started agent down.
   pub fn finish(&mut self, key: &ConnectionKey, id: u64) -> Option<Vec<W>> {
      let wanted = self
         .pending
         .get(key)
         .is_some_and(|pending| pending.id == id && !pending.token.is_cancelled());
      if !wanted {
         return None;
      }
      self.pending.remove(key).map(|pending| pending.waiters)
   }
}

/// How long an agent with nothing to do keeps running before it is shut down.
pub(super) const ACP_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Whether an agent connection can be shut down for being idle. Only a connection that is doing
/// nothing qualifies, and only when shutting it down loses nothing: it holds no sessions, or the
/// agent can reattach them later with `session/load` or `session/resume`.
pub(super) fn is_idle(
   last_activity: Instant,
   now: Instant,
   busy: bool,
   has_sessions: bool,
   can_reattach_sessions: bool,
) -> bool {
   !busy
      && (!has_sessions || can_reattach_sessions)
      && now.saturating_duration_since(last_activity) >= ACP_IDLE_TIMEOUT
}

#[cfg(test)]
mod tests {
   use super::*;

   fn key(agent_id: &str, workspace: &str) -> ConnectionKey {
      ConnectionKey::new(agent_id.to_string(), Some(PathBuf::from(workspace)))
   }

   #[cfg(unix)]
   #[test]
   fn a_workspace_reached_through_a_symlink_is_the_same_workspace() {
      let temp_dir = tempfile::tempdir().unwrap();
      let real = temp_dir.path().join("project");
      let link = temp_dir.path().join("link");
      std::fs::create_dir(&real).unwrap();
      std::os::unix::fs::symlink(&real, &link).unwrap();

      let through_link = ConnectionKey::new("claude".into(), Some(link.clone()));
      let direct = ConnectionKey::new("claude".into(), Some(real));
      assert_eq!(through_link, direct);
      assert_eq!(through_link.workspace_path, Some(link));
      assert_ne!(
         through_link,
         ConnectionKey::new("gemini".into(), Some(temp_dir.path().into()))
      );
   }

   #[test]
   fn a_workspace_that_cannot_be_resolved_keeps_its_own_path() {
      assert_eq!(
         key("claude", "/no/such/workspace"),
         key("claude", "/no/such/workspace")
      );
      assert_ne!(key("claude", "/no/such/a"), key("claude", "/no/such/b"));
   }

   #[test]
   fn routes_each_session_to_its_connection() {
      let mut registry = SessionRegistry::default();
      assert_eq!(registry.attach("a", 1), None);
      assert_eq!(registry.attach("b", 1), None);
      assert_eq!(registry.attach("c", 2), None);

      assert_eq!(registry.connection_of("a"), Some(1));
      assert_eq!(registry.connection_of("c"), Some(2));
      assert_eq!(registry.connection_of("missing"), None);
      assert_eq!(registry.sessions_of(1), vec!["a", "b"]);
      assert!(registry.is_open_on("b", 1));
      assert!(!registry.is_open_on("b", 2));

      assert_eq!(registry.detach("a"), Some(1));
      assert_eq!(registry.sessions_of(1), vec!["b"]);
      assert_eq!(registry.remove_connection(1), vec!["b"]);
      assert_eq!(registry.sessions_of(2), vec!["c"]);
   }

   #[test]
   fn reports_a_session_that_moved_to_another_connection() {
      let mut registry = SessionRegistry::default();
      registry.attach("a", 1);
      assert_eq!(
         registry.attach("a", 1),
         None,
         "reopening in place is not a move"
      );
      assert_eq!(registry.attach("a", 2), Some(1));
      assert_eq!(registry.sessions_of(1), Vec::<String>::new());
   }

   #[test]
   fn runs_one_prompt_per_session_and_many_per_connection() {
      let mut registry = SessionRegistry::default();
      registry.attach("a", 1);
      registry.attach("b", 1);

      assert_eq!(registry.begin_prompt("a").unwrap(), 1);
      assert!(registry.begin_prompt("a").is_err(), "one turn per session");
      assert_eq!(
         registry.begin_prompt("b").unwrap(),
         1,
         "another chat streams at the same time"
      );
      assert!(registry.has_running_prompt(1));

      registry.end_prompt("a");
      registry.end_prompt("b");
      assert!(!registry.has_running_prompt(1));
      assert!(registry.begin_prompt("missing").is_err());
   }

   #[test]
   fn chats_needing_a_starting_agent_share_its_startup() {
      let mut startups = Startups::default();
      let (first, _) = startups.join(key("claude", "/w"), "chat-1").unwrap();
      assert!(startups.join(key("claude", "/w"), "chat-2").is_none());
      assert!(
         startups.join(key("gemini", "/w"), "chat-3").is_some(),
         "different agents start side by side"
      );
      assert!(
         startups.join(key("claude", "/other"), "chat-4").is_some(),
         "the same agent in another workspace gets its own process"
      );

      assert_eq!(
         startups.finish(&key("claude", "/w"), first),
         Some(vec!["chat-1", "chat-2"])
      );
      assert_eq!(startups.finish(&key("claude", "/w"), first), None);
   }

   #[test]
   fn a_stopped_startup_hands_back_its_waiters_and_is_not_adopted() {
      let mut startups = Startups::default();
      let (id, token) = startups.join(key("claude", "/w"), "chat-1").unwrap();
      assert!(startups.stop(&key("gemini", "/w")).is_none());
      assert_eq!(startups.stop(&key("claude", "/w")), Some(vec!["chat-1"]));
      assert!(token.is_cancelled());
      assert_eq!(startups.finish(&key("claude", "/w"), id), None);

      let (old, _) = startups.join(key("claude", "/w"), "chat-2").unwrap();
      startups.join(key("gemini", "/w"), "chat-3");
      let mut stopped = startups.stop_all();
      stopped.sort();
      assert_eq!(stopped, vec!["chat-2", "chat-3"]);

      let (new, _) = startups.join(key("claude", "/w"), "chat-4").unwrap();
      assert_eq!(
         startups.finish(&key("claude", "/w"), old),
         None,
         "an older startup does not take over a newer one"
      );
      assert_eq!(
         startups.finish(&key("claude", "/w"), new),
         Some(vec!["chat-4"])
      );
   }

   #[test]
   fn shuts_down_only_agents_that_lose_nothing() {
      let start = Instant::now();
      let later = start + ACP_IDLE_TIMEOUT;
      let soon = start + ACP_IDLE_TIMEOUT / 2;

      assert!(is_idle(start, later, false, false, false));
      assert!(is_idle(start, later, false, true, true));
      assert!(
         !is_idle(start, soon, false, false, false),
         "not idle long enough"
      );
      assert!(
         !is_idle(start, later, true, true, true),
         "a prompt is running"
      );
      assert!(
         !is_idle(start, later, false, true, false),
         "its sessions could not be reattached"
      );
   }
}
