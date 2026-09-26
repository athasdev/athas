//! What happens to a session's updates while `session/load` replays its history. The agent
//! sends the whole conversation again as `session/update` notifications before it answers the
//! load. Athas keeps its own history, so reattaching a chat drops the replayed messages; importing
//! an agent's session collects them so the new chat can show them. Everything else the replay
//! carries (commands, modes, config options, session info, usage) still describes the session and
//! is emitted as usual.
//!
//! The SDK handles notifications one at a time, in order, before it routes the response they
//! precede, so every replayed update passes through here before the load returns.

use super::types::AcpEvent;
use std::{
   collections::{HashMap, VecDeque},
   sync::Mutex,
};

/// How many failed loads a connection keeps dropping updates for. Agents stop sending for a
/// failed load soon after; the oldest ones are forgotten so the list does not grow forever.
const MAX_DISCARDED_SESSIONS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ReplayMode {
   /// Reattaching a chat Athas has the history for: drop the replayed conversation.
   Suppress,
   /// Importing a session into a new chat: keep the replayed conversation for the caller.
   Collect,
   /// The load failed or timed out, and the chat moved on: drop whatever the agent still sends
   /// for the session, so nothing reaches the chat's next session or turn.
   Discard,
}

#[derive(Debug)]
struct Replay {
   mode: ReplayMode,
   collected: Vec<AcpEvent>,
}

/// The sessions being loaded on one agent connection, by session id.
#[derive(Debug, Default)]
pub(super) struct ReplayRouter {
   sessions: Mutex<HashMap<String, Replay>>,
   /// Discarded sessions, oldest first.
   discarded: Mutex<VecDeque<String>>,
}

impl ReplayRouter {
   fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, Replay>> {
      self
         .sessions
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
   }

   /// Starts routing `session_id`'s updates with `mode`, before `session/load` is sent.
   pub fn begin(&self, session_id: &str, mode: ReplayMode) {
      self.sessions().insert(
         session_id.to_string(),
         Replay {
            mode,
            collected: Vec::new(),
         },
      );
   }

   /// The load succeeded: later updates are live again. Returns the collected history.
   pub fn finish(&self, session_id: &str) -> Vec<AcpEvent> {
      self
         .sessions()
         .remove(session_id)
         .map(|replay| replay.collected)
         .unwrap_or_default()
   }

   /// The load failed: keep dropping the session's updates, for the most recent failed loads.
   pub fn discard(&self, session_id: &str) {
      let mut sessions = self.sessions();
      sessions.insert(
         session_id.to_string(),
         Replay {
            mode: ReplayMode::Discard,
            collected: Vec::new(),
         },
      );
      let mut discarded = self
         .discarded
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner());
      discarded.retain(|id| id != session_id);
      discarded.push_back(session_id.to_string());
      while discarded.len() > MAX_DISCARDED_SESSIONS {
         let Some(oldest) = discarded.pop_front() else {
            break;
         };
         if sessions
            .get(&oldest)
            .is_some_and(|replay| replay.mode == ReplayMode::Discard)
         {
            sessions.remove(&oldest);
         }
      }
   }

   /// Returns the event when it should be emitted now; replayed history is dropped or collected.
   pub fn route(&self, event: AcpEvent) -> Option<AcpEvent> {
      let Some(session_id) = session_id_of(&event) else {
         return Some(event);
      };
      let mut sessions = self.sessions();
      let Some(replay) = sessions.get_mut(session_id) else {
         return Some(event);
      };
      match replay.mode {
         ReplayMode::Discard => None,
         _ if !is_history(&event) => Some(event),
         ReplayMode::Suppress => None,
         ReplayMode::Collect => {
            replay.collected.push(event);
            None
         }
      }
   }
}

/// Whether the event is part of the conversation itself rather than the session's state.
fn is_history(event: &AcpEvent) -> bool {
   matches!(
      event,
      AcpEvent::UserMessageChunk { .. }
         | AcpEvent::ContentChunk { .. }
         | AcpEvent::ThoughtChunk { .. }
         | AcpEvent::ToolStart { .. }
         | AcpEvent::ToolUpdate { .. }
         | AcpEvent::ToolComplete { .. }
         | AcpEvent::PlanUpdate { .. }
   )
}

fn session_id_of(event: &AcpEvent) -> Option<&str> {
   match event {
      AcpEvent::UserMessageChunk { session_id, .. }
      | AcpEvent::ContentChunk { session_id, .. }
      | AcpEvent::ThoughtChunk { session_id, .. }
      | AcpEvent::ToolStart { session_id, .. }
      | AcpEvent::ToolUpdate { session_id, .. }
      | AcpEvent::ToolComplete { session_id, .. }
      | AcpEvent::PermissionRequest { session_id, .. }
      | AcpEvent::SessionComplete { session_id }
      | AcpEvent::SlashCommandsUpdate { session_id, .. }
      | AcpEvent::PlanUpdate { session_id, .. }
      | AcpEvent::UsageUpdate { session_id, .. }
      | AcpEvent::SessionModeUpdate { session_id, .. }
      | AcpEvent::CurrentModeUpdate { session_id, .. }
      | AcpEvent::ConfigOptionsUpdate { session_id, .. }
      | AcpEvent::SessionInfoUpdate { session_id, .. }
      | AcpEvent::PromptComplete { session_id, .. }
      | AcpEvent::UiAction { session_id, .. }
      | AcpEvent::AgentLocation { session_id, .. }
      | AcpEvent::AgentFileWrite { session_id, .. } => Some(session_id),
      AcpEvent::ElicitationRequest { session_id, .. }
      | AcpEvent::Error { session_id, .. }
      | AcpEvent::AuthRequired { session_id, .. } => session_id.as_deref(),
      AcpEvent::ElicitationComplete { .. }
      | AcpEvent::RequestClosed { .. }
      | AcpEvent::StatusChanged { .. } => None,
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::acp::types::AcpContentBlock;

   fn message(session_id: &str, text: &str) -> AcpEvent {
      AcpEvent::ContentChunk {
         session_id: session_id.to_string(),
         content: AcpContentBlock::Text {
            text: text.to_string(),
         },
         is_complete: false,
      }
   }

   fn current_mode(session_id: &str) -> AcpEvent {
      AcpEvent::CurrentModeUpdate {
         session_id: session_id.to_string(),
         current_mode_id: "code".to_string(),
      }
   }

   #[test]
   fn suppressing_drops_replayed_history_but_keeps_session_state() {
      let router = ReplayRouter::default();
      router.begin("s1", ReplayMode::Suppress);

      assert!(router.route(message("s1", "old answer")).is_none());
      assert!(router.route(current_mode("s1")).is_some());
      assert!(router.finish("s1").is_empty());
      assert!(router.route(message("s1", "new answer")).is_some());
   }

   #[test]
   fn collecting_keeps_replayed_history_for_the_caller() {
      let router = ReplayRouter::default();
      router.begin("s1", ReplayMode::Collect);

      assert!(router.route(message("s1", "one")).is_none());
      assert!(router.route(current_mode("s1")).is_some());
      assert!(router.route(message("s1", "two")).is_none());

      let collected = router.finish("s1");
      assert_eq!(collected.len(), 2);
      assert!(matches!(
         &collected[0],
         AcpEvent::ContentChunk { content: AcpContentBlock::Text { text }, .. } if text == "one"
      ));
      assert!(router.route(message("s1", "live")).is_some());
   }

   #[test]
   fn replay_of_one_session_leaves_other_sessions_alone() {
      let router = ReplayRouter::default();
      router.begin("loading", ReplayMode::Suppress);

      assert!(router.route(message("other", "live")).is_some());
      assert!(
         router
            .route(AcpEvent::StatusChanged {
               status: Default::default(),
               error: None,
            })
            .is_some()
      );
   }

   #[test]
   fn a_failed_load_drops_everything_the_session_still_sends() {
      let router = ReplayRouter::default();
      router.begin("s1", ReplayMode::Suppress);
      router.discard("s1");

      assert!(router.route(message("s1", "late replay")).is_none());
      assert!(router.route(current_mode("s1")).is_none());

      // Loading it again later routes it afresh.
      router.begin("s1", ReplayMode::Collect);
      assert!(router.route(current_mode("s1")).is_some());
   }

   #[test]
   fn only_the_most_recent_failed_loads_are_remembered() {
      let router = ReplayRouter::default();
      router.begin("loading", ReplayMode::Suppress);
      for index in 0..=MAX_DISCARDED_SESSIONS {
         router.discard(&format!("failed-{index}"));
      }

      assert!(router.route(current_mode("failed-0")).is_some());
      assert!(router.route(current_mode("failed-1")).is_none());
      assert!(
         router
            .route(current_mode(&format!("failed-{MAX_DISCARDED_SESSIONS}")))
            .is_none()
      );
      assert_eq!(router.sessions().len(), MAX_DISCARDED_SESSIONS + 1);
      assert!(router.route(message("loading", "replay")).is_none());
   }
}
